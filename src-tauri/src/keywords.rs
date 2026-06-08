use std::collections::HashMap;

const STOP_WORDS: &[&str] = &[
    "a","about","above","after","again","against","all","am","an","and","any","are","as","at",
    "be","because","been","before","being","below","between","both","but","by","can","did",
    "do","does","doing","down","during","each","few","for","from","get","got","had","has",
    "have","having","he","her","here","him","his","how","i","if","in","into","is","it","its",
    "itself","just","me","more","most","my","no","not","now","of","off","on","once","only",
    "or","other","our","out","over","own","s","same","she","should","so","some","such","t",
    "than","that","the","their","them","then","there","these","they","this","those","through",
    "to","too","under","until","up","us","very","was","we","were","what","when","where",
    "which","while","who","will","with","would","you","your","also","may","one","two","three",
    "new","use","used","using","like","make","see","many","much","way","ve","re","ll","d",
    "doesn","didn","isn","aren","wasn","weren","hasn","haven","hadn","won","wouldn","couldn",
    "shouldn","mustn","shan","mightn","needn","let","go","going","come","comes","came","take",
    "takes","took","know","knew","think","thought","want","wanted","need","needed","time",
    "first","last","long","great","little","own","right","big","high","different","small",
    "large","next","early","young","important","public","private","real","best","free","able",
];

pub fn extract_keywords(title: &str, body: &str, top_n: usize) -> Vec<String> {
    let _ = title;
    let text = body;
    let mut counts: HashMap<String, usize> = HashMap::new();

    for word in text.split(|c: char| !c.is_alphanumeric()) {
        if word.len() < 3 {
            continue;
        }
        let lower = word.to_lowercase();
        if STOP_WORDS.contains(&lower.as_str()) {
            continue;
        }
        // Skip pure numbers
        if lower.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        *counts.entry(lower).or_default() += 1;
    }

    let mut ranked: Vec<(String, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked.into_iter().take(top_n).map(|(w, _)| w).collect()
}
