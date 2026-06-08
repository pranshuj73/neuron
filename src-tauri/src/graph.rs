use crate::db;
use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteNode {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub tags: Vec<String>,
    pub embedded_at: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub edge_type: String,
    pub similarity: Option<f32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphPayload {
    pub nodes: Vec<NoteNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MissingLink {
    pub source: NoteNode,
    pub target: NoteNode,
    pub similarity: f32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub hubs: Vec<NoteNode>,
    pub orphans: Vec<NoteNode>,
    pub suggestions: Vec<MissingLink>,
}

pub async fn build_graph(
    db: Arc<Mutex<Connection>>,
    qdrant_url: String,
    similarity_threshold: f32,
) -> Result<GraphPayload> {
    // Load all notes
    let notes = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.lock().unwrap();
            db::get_all_notes(&conn)
        }
    })
    .await??;

    // Load all explicit links
    let explicit_links = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.lock().unwrap();
            db::get_all_explicit_links(&conn)
        }
    })
    .await??;

    // Parse tags JSON for each note
    let nodes: Vec<NoteNode> = notes
        .iter()
        .map(|n| NoteNode {
            id: n.id.clone(),
            title: n.title.clone(),
            file_path: n.file_path.clone(),
            tags: serde_json::from_str(&n.tags).unwrap_or_default(),
            embedded_at: n.embedded_at,
        })
        .collect();

    let node_map: HashMap<String, &NoteNode> = nodes.iter().map(|n| (n.id.clone(), n)).collect();

    // Build explicit edges
    let mut edges: Vec<GraphEdge> = explicit_links
        .iter()
        .filter(|l| node_map.contains_key(&l.source_id) && node_map.contains_key(&l.target_id))
        .map(|l| GraphEdge {
            source: l.source_id.clone(),
            target: l.target_id.clone(),
            edge_type: format!("explicit_{}", l.link_type),
            similarity: None,
        })
        .collect();

    // Track existing explicit pairs to avoid duplicate semantic edges
    let explicit_pairs: HashSet<(String, String)> = explicit_links
        .iter()
        .flat_map(|l| {
            [
                (l.source_id.clone(), l.target_id.clone()),
                (l.target_id.clone(), l.source_id.clone()),
            ]
        })
        .collect();

    // Build semantic edges via Qdrant
    let embedded_node_ids: Vec<String> = notes
        .iter()
        .filter(|n| n.embedded_at.is_some())
        .map(|n| n.id.clone())
        .collect();

    let mut seen_semantic_pairs: HashSet<(String, String)> = HashSet::new();

    for source_id in &embedded_node_ids {
        // Get this note's vector from Qdrant
        let vector = match crate::qdrant::get_vector(&qdrant_url, source_id).await? {
            Some(v) => v,
            None => continue,
        };

        let similar = crate::qdrant::search_similar(
            &qdrant_url,
            vector,
            11, // +1 to account for self-match
            similarity_threshold,
        )
        .await?;

        for (target_id, score) in similar {
            if &target_id == source_id {
                continue;
            }
            if !node_map.contains_key(&target_id) {
                continue;
            }

            // Deduplicate: only emit one edge per pair
            let pair = if source_id < &target_id {
                (source_id.clone(), target_id.clone())
            } else {
                (target_id.clone(), source_id.clone())
            };

            if seen_semantic_pairs.contains(&pair) {
                continue;
            }
            if explicit_pairs.contains(&(source_id.clone(), target_id.clone())) {
                continue;
            }

            seen_semantic_pairs.insert(pair);
            edges.push(GraphEdge {
                source: source_id.clone(),
                target: target_id.clone(),
                edge_type: "semantic".to_string(),
                similarity: Some(score),
            });
        }
    }

    Ok(GraphPayload { nodes, edges })
}

pub async fn compute_insights(
    db: Arc<Mutex<Connection>>,
    qdrant_url: String,
    similarity_threshold: f32,
) -> Result<Insights> {
    let graph = build_graph(db, qdrant_url, similarity_threshold).await?;

    // Degree map
    let mut degree: HashMap<String, usize> = graph.nodes.iter().map(|n| (n.id.clone(), 0)).collect();
    for edge in &graph.edges {
        *degree.entry(edge.source.clone()).or_default() += 1;
        *degree.entry(edge.target.clone()).or_default() += 1;
    }

    let node_map: HashMap<String, NoteNode> =
        graph.nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();

    // Hubs: top 10 by degree (must have at least 1 edge)
    let mut hub_entries: Vec<(&String, &usize)> = degree.iter().collect();
    hub_entries.sort_by(|a, b| b.1.cmp(a.1));
    let hubs: Vec<NoteNode> = hub_entries
        .iter()
        .filter(|(_, &d)| d > 0)
        .take(10)
        .filter_map(|(id, _)| node_map.get(*id).cloned())
        .collect();

    // Orphans: degree == 0
    let orphans: Vec<NoteNode> = graph
        .nodes
        .iter()
        .filter(|n| degree.get(&n.id).copied().unwrap_or(0) == 0)
        .cloned()
        .collect();

    // Missing link suggestions: semantic edges where no explicit link exists
    // (these are already filtered in build_graph, so all semantic edges qualify)
    let explicit_pairs: HashSet<(String, String)> = graph
        .edges
        .iter()
        .filter(|e| e.edge_type.starts_with("explicit"))
        .flat_map(|e| {
            [
                (e.source.clone(), e.target.clone()),
                (e.target.clone(), e.source.clone()),
            ]
        })
        .collect();

    let suggestions: Vec<MissingLink> = graph
        .edges
        .iter()
        .filter(|e| e.edge_type == "semantic")
        .filter(|e| !explicit_pairs.contains(&(e.source.clone(), e.target.clone())))
        .filter_map(|e| {
            let source = node_map.get(&e.source)?.clone();
            let target = node_map.get(&e.target)?.clone();
            Some(MissingLink {
                source,
                target,
                similarity: e.similarity.unwrap_or(0.0),
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .take(20)
        .collect();

    Ok(Insights {
        hubs,
        orphans,
        suggestions,
    })
}
