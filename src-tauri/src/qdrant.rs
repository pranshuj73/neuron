use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::{json, Value};

pub async fn health_check(url: &str) -> bool {
    let client = Client::new();
    client
        .get(format!("{}/healthz", url))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn ensure_collection(url: &str, vector_size: u64) -> Result<()> {
    let client = Client::new();
    let collection_url = format!("{}/collections/notes", url);

    // Check if collection exists and get its config
    let res = client.get(&collection_url).send().await?;
    if res.status().is_success() {
        let body: Value = res.json().await?;
        let existing_size = body["result"]["config"]["params"]["vectors"]["size"]
            .as_u64()
            .unwrap_or(0);
        if existing_size != vector_size {
            // Mismatch — delete and recreate
            client
                .delete(&collection_url)
                .send()
                .await?
                .error_for_status()?;
            create_collection(&client, url, vector_size).await?;
        }
        // Sizes match — nothing to do
        return Ok(());
    }

    // Collection doesn't exist — create it
    create_collection(&client, url, vector_size).await
}

async fn create_collection(client: &Client, url: &str, vector_size: u64) -> Result<()> {
    let res = client
        .put(format!("{}/collections/notes", url))
        .json(&json!({
            "vectors": {
                "size": vector_size,
                "distance": "Cosine"
            }
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(anyhow!("Failed to create Qdrant collection: {}", body));
    }
    Ok(())
}

pub async fn upsert_point(
    url: &str,
    note_id: &str,
    vector: Vec<f32>,
    title: &str,
    file_path: &str,
) -> Result<()> {
    let client = Client::new();
    let res = client
        .put(format!("{}/collections/notes/points", url))
        .json(&json!({
            "points": [{
                "id": note_id,
                "vector": vector,
                "payload": {
                    "note_id": note_id,
                    "title": title,
                    "file_path": file_path,
                }
            }]
        }))
        .send()
        .await?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(anyhow!("Failed to upsert Qdrant point: {}", body));
    }
    Ok(())
}

pub async fn delete_point(url: &str, note_id: &str) -> Result<()> {
    let client = Client::new();
    client
        .post(format!("{}/collections/notes/points/delete", url))
        .json(&json!({ "points": [note_id] }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Returns Vec<(note_id, score)> for notes similar to the query vector
pub async fn search_similar(
    url: &str,
    vector: Vec<f32>,
    top_k: usize,
    threshold: f32,
) -> Result<Vec<(String, f32)>> {
    let client = Client::new();
    let res = client
        .post(format!("{}/collections/notes/points/search", url))
        .json(&json!({
            "vector": vector,
            "limit": top_k,
            "score_threshold": threshold,
            "with_payload": true,
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(anyhow!("Qdrant search failed: {}", body));
    }

    let body: Value = res.json().await?;
    let results = body["result"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let note_id = item["payload"]["note_id"].as_str()?.to_string();
                    let score = item["score"].as_f64()? as f32;
                    Some((note_id, score))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(results)
}

/// Retrieve a vector for a given note_id from Qdrant
pub async fn get_vector(url: &str, note_id: &str) -> Result<Option<Vec<f32>>> {
    let client = Client::new();
    let res = client
        .post(format!("{}/collections/notes/points", url))
        .json(&json!({
            "ids": [note_id],
            "with_vector": true,
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        return Ok(None);
    }

    let body: Value = res.json().await?;
    let vector = body["result"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item["vector"].as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect()
        });

    Ok(vector)
}
