use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;

pub struct EmbedSettings {
    pub provider: String,
    pub hf_api_key: String,
    pub hf_model: String,
    pub ollama_url: String,
    pub ollama_model: String,
}

pub async fn embed_text(text: &str, settings: &EmbedSettings) -> Result<Vec<f32>> {
    match settings.provider.as_str() {
        "ollama" => embed_ollama(text, settings).await,
        _ => embed_hf(text, settings).await,
    }
}

async fn embed_hf(text: &str, settings: &EmbedSettings) -> Result<Vec<f32>> {
    let client = Client::new();
    let url = format!(
        "https://router.huggingface.co/hf-inference/models/{}/pipeline/feature-extraction",
        settings.hf_model
    );

    let mut attempts = 0u32;
    loop {
        attempts += 1;
        let res = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", settings.hf_api_key))
            .json(&json!({ "inputs": text }))
            .send()
            .await?;

        if res.status() == 429 {
            if attempts >= 3 {
                return Err(anyhow!("HuggingFace rate limit exceeded after 3 retries"));
            }
            let retry_after = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(2);
            sleep(Duration::from_secs(retry_after)).await;
            continue;
        }

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("HuggingFace API error {}: {}", status, body));
        }

        let body: Value = res.json().await?;

        // Response is [[f32, ...]] — take [0]
        let embedding = body
            .as_array()
            .and_then(|outer| outer.first())
            .and_then(|inner| inner.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_f64().map(|f| f as f32))
                    .collect::<Vec<f32>>()
            });

        // Also handle flat [f32, ...] response (some HF models return flat)
        let embedding = embedding.or_else(|| {
            body.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_f64().map(|f| f as f32))
                    .collect()
            })
        });

        return embedding.ok_or_else(|| anyhow!("Unexpected HuggingFace response format"));
    }
}

async fn embed_ollama(text: &str, settings: &EmbedSettings) -> Result<Vec<f32>> {
    let client = Client::new();

    // Try the newer /api/embed endpoint first (Ollama >= 0.3, supports Qwen3-Embedding)
    let url = format!("{}/api/embed", settings.ollama_url);
    let res = client
        .post(&url)
        .json(&json!({ "model": settings.ollama_model, "input": text }))
        .send()
        .await
        .map_err(|e| anyhow!("Ollama connection failed: {}. Is Ollama running?", e))?;

    if res.status().is_success() {
        let body: Value = res.json().await?;
        // /api/embed returns {"embeddings": [[...]]}
        if let Some(vec) = body["embeddings"]
            .as_array()
            .and_then(|outer| outer.first())
            .and_then(|inner| inner.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect::<Vec<_>>())
        {
            return Ok(vec);
        }
    }

    // Fall back to legacy /api/embeddings (Ollama < 0.3)
    let url = format!("{}/api/embeddings", settings.ollama_url);
    let res = client
        .post(&url)
        .json(&json!({ "model": settings.ollama_model, "prompt": text }))
        .send()
        .await
        .map_err(|e| anyhow!("Ollama connection failed: {}. Is Ollama running?", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(anyhow!("Ollama API error {}: {}", status, body));
    }

    let body: Value = res.json().await?;
    body["embedding"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
        .ok_or_else(|| anyhow!("Ollama response missing 'embedding' field"))
}

/// Embeds a short test string to measure the model's actual output dimension.
pub async fn detect_vector_size(settings: &EmbedSettings) -> Result<u64> {
    let v = embed_text("dimension probe", settings).await?;
    Ok(v.len() as u64)
}

pub fn prepare_text(title: &str, tags: &[String], body: &str) -> String {
    let tags_str = tags.join(" ");
    format!("{}\n{}\n{}", title, tags_str, body)
}
