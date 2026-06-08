use gray_matter::{engine::YAML, Matter};
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::Regex;
use std::path::Path;
use std::sync::OnceLock;

pub struct ParsedNote {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub headings: Vec<String>,
    pub wiki_links: Vec<String>,
    pub md_links: Vec<String>,
}

static WIKI_LINK_RE: OnceLock<Regex> = OnceLock::new();

fn wiki_re() -> &'static Regex {
    WIKI_LINK_RE.get_or_init(|| Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]").unwrap())
}

pub fn parse(path: &Path, raw_content: &str) -> ParsedNote {
    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(raw_content);
    let content: &str = &parsed.content;

    let tags = extract_tags_from_matter(&parsed.data);
    let wiki_links = extract_wiki_links(content);
    let (title_from_h1, headings, body, md_links) = extract_via_cmark(content);

    let title = title_from_h1.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string()
    });

    ParsedNote {
        title,
        body,
        tags,
        headings,
        wiki_links,
        md_links,
    }
}

fn extract_tags_from_matter(data: &Option<gray_matter::Pod>) -> Vec<String> {
    let Some(pod) = data else {
        return vec![];
    };
    match pod {
        gray_matter::Pod::Hash(map) => {
            if let Some(tags_val) = map.get("tags") {
                match tags_val {
                    gray_matter::Pod::Array(arr) => arr
                        .iter()
                        .filter_map(|p| {
                            if let gray_matter::Pod::String(s) = p {
                                Some(s.clone())
                            } else {
                                None
                            }
                        })
                        .collect(),
                    gray_matter::Pod::String(s) => {
                        s.split(',').map(|t| t.trim().to_string()).collect()
                    }
                    _ => vec![],
                }
            } else {
                vec![]
            }
        }
        _ => vec![],
    }
}

fn extract_wiki_links(content: &str) -> Vec<String> {
    wiki_re()
        .captures_iter(content)
        .map(|cap| cap[1].trim().to_string())
        .collect()
}

fn extract_via_cmark(content: &str) -> (Option<String>, Vec<String>, String, Vec<String>) {
    let opts = Options::empty();
    let parser = Parser::new_ext(content, opts);

    let mut title: Option<String> = None;
    let mut headings: Vec<String> = Vec::new();
    let mut body_parts: Vec<String> = Vec::new();
    let mut md_links: Vec<String> = Vec::new();

    let mut in_heading = false;
    let mut heading_level = HeadingLevel::H1;
    let mut current_heading_text = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = true;
                heading_level = level;
                current_heading_text.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                let text = current_heading_text.trim().to_string();
                if !text.is_empty() {
                    if heading_level == HeadingLevel::H1 && title.is_none() {
                        title = Some(text.clone());
                    } else {
                        headings.push(text.clone());
                    }
                    body_parts.push(text);
                }
                in_heading = false;
                current_heading_text.clear();
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                let url = dest_url.to_string();
                if url.ends_with(".md") || (!url.starts_with("http") && !url.starts_with('#')) {
                    md_links.push(url);
                }
            }
            Event::Text(text) => {
                if in_heading {
                    current_heading_text.push_str(&text);
                } else {
                    body_parts.push(text.to_string());
                }
            }
            Event::Code(code) => {
                body_parts.push(code.to_string());
            }
            _ => {}
        }
    }

    let body = body_parts.join(" ");
    (title, headings, body, md_links)
}
