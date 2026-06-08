use anyhow::Result;
use tokio::process::Command;
use tokio::time::{sleep, Duration};

const CONTAINER_NAME: &str = "neuron-qdrant";
const QDRANT_IMAGE: &str = "qdrant/qdrant";
const QDRANT_URL: &str = "http://localhost:6333";

pub async fn is_docker_available() -> bool {
    Command::new("docker")
        .args(["version"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

pub async fn start_qdrant() -> Result<()> {
    if crate::qdrant::health_check(QDRANT_URL).await {
        return Ok(());
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let storage_path = format!("{}/.neuron/qdrant_storage", home);
    std::fs::create_dir_all(&storage_path)?;

    // Check if our container already exists (running or stopped)
    let inspect = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Running}}", CONTAINER_NAME])
        .output()
        .await;

    match inspect {
        Ok(out) if out.status.success() => {
            let running = String::from_utf8_lossy(&out.stdout).trim() == "true";
            if !running {
                Command::new("docker")
                    .args(["start", CONTAINER_NAME])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .await?;
            }
        }
        _ => {
            // Container doesn't exist — create it (image pull happens automatically)
            Command::new("docker")
                .args([
                    "run",
                    "-d",
                    "--name",
                    CONTAINER_NAME,
                    "-p",
                    "6333:6333",
                    "-v",
                    &format!("{}:/qdrant/storage", storage_path),
                    QDRANT_IMAGE,
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await?;
        }
    }

    // Poll up to 60s — first run may pull the image
    for _ in 0..120 {
        sleep(Duration::from_millis(500)).await;
        if crate::qdrant::health_check(QDRANT_URL).await {
            return Ok(());
        }
    }

    Err(anyhow::anyhow!(
        "Qdrant container failed to become healthy within 60s"
    ))
}
