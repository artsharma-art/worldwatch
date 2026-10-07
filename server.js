import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const GDELT_DOC =
  "https://api.gdeltproject.org/api/v2/doc/doc";

const GDELT_GEO =
  "https://api.gdeltproject.org/api/v2/geo/geo";

const QUERY =
  '("war" OR "armed conflict" OR "fighting" OR "airstrike" OR "ceasefire" OR "military conflict")';

let newsCache = {
  articles: [],
  updatedAt: 0
};

let geoCache = {
  features: [],
  updatedAt: 0
};

const CACHE_MS = 60000;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "WorldWatch/1.0"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Upstream HTTP ${response.status}`);
  }

  return await response.json();
}

async function getNews() {
  if (Date.now() - newsCache.updatedAt < CACHE_MS) {
    return newsCache;
  }

  const params = new URLSearchParams({
    query: QUERY,
    mode: "artlist",
    format: "json",
    maxrecords: "50",
    timespan: "24h",
    sort: "datedesc"
  });

  const data = await fetchJson(
    `${GDELT_DOC}?${params.toString()}`
  );

  newsCache = {
    articles: Array.isArray(data.articles)
      ? data.articles
      : [],
    updatedAt: Date.now()
  };

  return newsCache;
}

async function getGeo() {
  if (Date.now() - geoCache.updatedAt < CACHE_MS) {
    return geoCache;
  }

  const params = new URLSearchParams({
    query: QUERY,
    mode: "pointdata",
    format: "geojson",
    timespan: "24h"
  });

  const data = await fetchJson(
    `${GDELT_GEO}?${params.toString()}`
  );

  geoCache = {
    features: Array.isArray(data.features)
      ? data.features
      : [],
    updatedAt: Date.now()
  };

  return geoCache;
}

app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    ok: true,
    service: "WORLDWATCH",
    time: new Date().toISOString()
  });
});

app.get("/api/news", async (req, res) => {
  try {
    const data = await getNews();

    res.set("Cache-Control", "no-store");

    res.json({
      ok: true,
      articles: data.articles,
      updatedAt: data.updatedAt
    });

  } catch (error) {
    console.error("NEWS ERROR:", error.message);

    res.status(502).set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      ok: false,
      error:
        "The live news provider could not be reached.",
      articles: newsCache.articles,
      updatedAt: newsCache.updatedAt
    });
  }
});

app.get("/api/geo", async (req, res) => {
  try {
    const data = await getGeo();

    res.set("Cache-Control", "no-store");

    res.json({
      ok: true,
      features: data.features,
      updatedAt: data.updatedAt
    });

  } catch (error) {
    console.error("GEO ERROR:", error.message);

    res.status(502).set(
      "Cache-Control",
      "no-store"
    );

    res.json({
      ok: false,
      error:
        "The geographic news provider could not be reached.",
      features: geoCache.features,
      updatedAt: geoCache.updatedAt
    });
  }
});

app.get("/api/all", async (req, res) => {
  const results = await Promise.allSettled([
    getNews(),
    getGeo()
  ]);

  const news =
    results[0].status === "fulfilled"
      ? results[0].value
      : {
          articles: [],
          updatedAt: 0
        };

  const geo =
    results[1].status === "fulfilled"
      ? results[1].value
      : {
          features: [],
          updatedAt: 0
        };

  const ok = results.some(
    result => result.status === "fulfilled"
  );

  res.status(ok ? 200 : 502);

  res.set("Cache-Control", "no-store");

  res.json({
    ok,
    articles: news.articles,
    features: geo.features,
    updatedAt: Math.max(
      news.updatedAt || 0,
      geo.updatedAt || 0
    )
  });
});

app.get("*", (req, res) => {
  res.sendFile("index.html", {
    root: "public"
  });
});

app.listen(PORT, () => {
  console.log(
    `WORLDWATCH running on port ${PORT}`
  );
});
