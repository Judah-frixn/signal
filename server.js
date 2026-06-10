const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const CATS = {
  all: {
    q: "startup OR funding OR ecommerce OR SaaS OR stock OR AI",
    category: "business,technology",
    defaultTag: "Business",
    tagRules: [
      { term: "funding", tag: "Funding" },
      { term: "investment", tag: "Funding" },
      { term: "valuation", tag: "Funding" },
      { term: "d2c", tag: "D2C" },
      { term: "ecommerce", tag: "D2C" },
      { term: "brand", tag: "D2C" },
      { term: "saas", tag: "SaaS & B2B" },
      { term: "software", tag: "SaaS & B2B" },
      { term: "b2b", tag: "SaaS & B2B" },
      { term: "fintech", tag: "Finance" },
      { term: "app", tag: "B2C" },
      { term: "platform", tag: "B2C" },
      { term: "nifty", tag: "Finance" },
      { term: "sensex", tag: "Finance" },
      { term: "rbi", tag: "Finance" },
      { term: "stocks", tag: "Finance" },
      { term: "generative", tag: "AI Tools" },
      { term: "llm", tag: "AI Tools" },
      { term: "gpt", tag: "AI Tools" },
      { term: "ai", tag: "AI Tools" }
    ]
  },
  funding: {
    q: "funding OR investment OR startup OR VC",
    category: "business",
    defaultTag: "Funding",
    tagRules: []
  },
  d2c: {
    q: "D2C OR ecommerce OR retail OR brand",
    category: "business",
    defaultTag: "D2C",
    tagRules: []
  },
  saas: {
    q: "SaaS OR B2B OR software OR enterprise",
    category: "technology",
    defaultTag: "SaaS & B2B",
    tagRules: []
  },
  b2c: {
    q: "consumer OR fintech OR app OR platform OR trend",
    category: "business",
    defaultTag: "B2C",
    tagRules: []
  },
  finance: {
    q: "Nifty OR Sensex OR stocks OR market OR RBI",
    category: "business",
    defaultTag: "Finance",
    tagRules: []
  },
  ai: {
    q: "AI OR intelligence OR LLM OR generative OR GPT",
    category: "technology",
    defaultTag: "AI Tools",
    tagRules: []
  }
};

// Log initial configurations
console.log("Initializing Signal Backend...");
if (!process.env.NEWSDATA_API_KEY) {
  console.warn("WARNING: Environment variable NEWSDATA_API_KEY is not defined. News requests will fail.");
}

// ── GET /news/:category ──────────────────────────────────────
app.get('/news/:category', async (req, res) => {
  const catKey = req.params.category;
  const cat = CATS[catKey];
  
  if (!cat) {
    return res.status(400).json({ error: `Invalid category: ${catKey}` });
  }

  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "NEWSDATA_API_KEY is not configured on the server. Please configure it in your Render settings." });
  }

  try {
    const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&q=${encodeURIComponent(cat.q)}&language=en&country=in&category=${cat.category}`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    if (data.status === "error") {
      throw new Error(data.results?.message || "NewsData API returned an error");
    }

    const results = data.results || [];
    let processed = [];

    results.forEach(a => {
      let assignedTag = cat.defaultTag;
      if (catKey === "all") {
        const textToMatch = ((a.title || "") + " " + (a.description || "")).toLowerCase();
        for (const rule of cat.tagRules) {
          if (textToMatch.includes(rule.term)) {
            assignedTag = rule.tag;
            break;
          }
        }
      }
      
      processed.push({
        title: a.title || "Untitled",
        description: a.description || "",
        link: a.link || "",
        source: a.source_id ? a.source_id.toUpperCase().replace(/_/g, " ") : "NEWS",
        pubDate: a.pubDate || "",
        category: assignedTag
      });
    });

    // Deduplicate by title prefix (first 55 chars)
    const seen = new Set();
    processed = processed.filter(a => {
      const k = (a.title || "").toLowerCase().slice(0, 55);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Sort chronologically (newest first)
    processed.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    // Keep top 20
    processed = processed.slice(0, 20);

    return res.json({ articles: processed });

  } catch (error) {
    console.error(`Error loading category ${catKey}:`, error.message);
    return res.status(500).json({ error: error.message || "Failed to fetch articles" });
  }
});

// ── GET /article?url=... ─────────────────────────────────────
app.get('/article', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ error: "Missing required parameter 'url'" });
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 8000
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Remove heavy script, styling, and navigation components
    $('script, style, iframe, nav, header, footer, noscript, svg, form, iframe, .ads, .advertisement, .sidebar, #sidebar, .comments, #comments, .newsletter-box').remove();

    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.story-content',
      '.article-content',
      '#article-body',
      '#story-body',
      '.content-area'
    ];

    let mainElement = null;
    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        mainElement = el;
        break;
      }
    }

    if (!mainElement) {
      mainElement = $('body');
    }

    // Extract text blocks
    const paragraphs = [];
    mainElement.find('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 25) { 
        paragraphs.push(text);
      }
    });

    if (paragraphs.length === 0) {
      const text = mainElement.text().trim();
      if (text.length > 100) {
        return res.json({ content: text.replace(/\s+/g, ' ').slice(0, 2500) });
      } else {
        throw new Error("Extracted text block is too short");
      }
    }

    const content = paragraphs.join('\n\n');
    return res.json({ content });

  } catch (error) {
    console.error(`Error scraping URL ${url}:`, error.message);
    return res.status(500).json({ error: error.message || "Failed to extract article content" });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Signal backend service active on port ${PORT}`);
});
