import TelegramBot from "node-telegram-bot-api";
import { searchTapAz } from "../search/tapaz.js";
import { searchTurboAz } from "../search/turboaz.js";
import { searchBinaAz } from "../search/binaaz.js";
import { searchDuckDuckGo } from "../search/duckduckgo.js";
import { extractContent } from "../scraper/extractor.js";
import { recordSearch, formatStatsMessage } from "../stats/stats.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required. Get one from @BotFather on Telegram.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function normalizeQuery(query: string): string {
  return query
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .trim();
}

async function trackAndReply(
  chatId: number,
  userId: string,
  username: string | undefined,
  tool: string,
  query: string,
  handler: () => Promise<{ text: string; count: number }>
): Promise<void> {
  const typing = bot.sendChatAction(chatId, "typing");
  const start = Date.now();

  try {
    await typing;
    const result = await handler();
    const elapsed = Date.now() - start;

    recordSearch({
      query,
      tool,
      userId,
      username,
      responseTimeMs: elapsed,
      resultCount: result.count,
    });

    const footer = `\n\n_${elapsed}ms | ${result.count} nəticə_`;
    const message = result.text + footer;

    await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await bot.sendMessage(chatId, `Xəta baş verdi: ${escapeMarkdown(message)}`);
  }
}

// /start
bot.onText(/\/start/, async (msg) => {
  const welcome = [
    "🔍 *Deep Search Bot*",
    "",
    "Azərbaycan bazarlarında və internetdə axtarış edin\\!",
    "",
    "*Əmrlər:*",
    "/search \\<sorğu\\> — İnternetdə axtarış",
    "/tapaz \\<sorğu\\> — tap\\.az\\-da axtarış",
    "/turbo — turbo\\.az\\-da maşın axtarışı",
    "/bina — bina\\.az\\-da mənzil axtarışı",
    "/extract \\<URL\\> — Veb səhifəni oxu",
    "/stats — Statistika",
    "/help — Kömək",
    "",
    "Sadəcə mesaj yazın və mən internetdə axtaracam\\!",
  ].join("\n");

  await bot.sendMessage(msg.chat.id, welcome, { parse_mode: "MarkdownV2" });
});

// /help
bot.onText(/\/help/, async (msg) => {
  const help = [
    "🔍 *Deep Search Bot — Kömək*",
    "",
    "*Web Axtarış:*",
    "/search iPhone 15 qiymət",
    "/search Azerbaijan technology startups",
    "",
    "*tap\\.az \\(ümumi bazar\\):*",
    "/tapaz iPhone 13",
    "/tapaz SSD 512GB",
    "/tapaz laptop",
    "",
    "*turbo\\.az \\(avtomobillər\\):*",
    "/turbo — bütün maşınlar",
    "/turbo mercedes 10000",
    "/turbo toyota 5000 2015",
    "",
    "*bina\\.az \\(daşınmaz əmlak\\):*",
    "/bina — satılık mənzillər",
    "/bina rent 500 — kirayə \\<500 AZN",
    "/bina 100000 80 — satılık \\<100k, \\>80m²",
    "",
    "*Digər:*",
    "/extract https://example\\.com — Səhifə məzmunu",
    "/stats — İstifadə statistikası",
  ].join("\n");

  await bot.sendMessage(msg.chat.id, help, { parse_mode: "MarkdownV2" });
});

// /search <query>
bot.onText(/\/search\s+(.+)/, async (msg, match) => {
  const query = match?.[1] || "";
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  await trackAndReply(msg.chat.id, userId, username, "web_search", query, async () => {
    const results = await searchDuckDuckGo(query, 5);

    if (results.length === 0) {
      return { text: `Heç bir nəticə tapılmadı: "${query}"`, count: 0 };
    }

    const lines = [`🔍 *Web Axtarış:* "${escapeMarkdown(query)}"`, ""];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`*${i + 1}.* ${escapeMarkdown(r.title)}`);
      lines.push(`${r.url}`);
      if (r.snippet) lines.push(`_${escapeMarkdown(r.snippet.substring(0, 120))}_`);
      lines.push("");
    }

    return { text: lines.join("\n"), count: results.length };
  });
});

// /tapaz <query> [min_price]
// Price must be >= 50 to be treated as filter (so "iPhone 15" works)
bot.onText(/\/tapaz\s+(.+)/, async (msg, match) => {
  const parts = (match?.[1] || "").trim().split(/\s+/);
  let minPrice: number | undefined;

  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart) && parts.length > 1 && parseInt(lastPart) >= 50) {
    minPrice = parseInt(lastPart);
    parts.pop();
  }

  const query = normalizeQuery(parts.join(" "));
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  await trackAndReply(msg.chat.id, userId, username, "tapaz", query, async () => {
    const rawListings = await searchTapAz(query, {
      maxResults: 30,
      sortByPrice: "asc",
      minPrice,
    });

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const listings = rawListings.filter((l) => {
      const titleLower = l.title.toLowerCase();
      return queryWords.every((word) => titleLower.includes(word));
    }).slice(0, 10);

    if (listings.length === 0 && rawListings.length > 0) {
      const fallback = rawListings.slice(0, 10);
      const lines = [`🛒 *tap.az:* "${escapeMarkdown(query)}" (tam uyğun nəticə tapılmadı, oxşar nəticələr)`, ""];
      for (let i = 0; i < fallback.length; i++) {
        const l = fallback[i];
        lines.push(`*${i + 1}.* ${escapeMarkdown(l.title)}`);
        lines.push(`   💰 *${l.price} AZN* | 📍 ${l.region}`);
        lines.push(`   ${l.url}`);
        lines.push("");
      }
      return { text: lines.join("\n"), count: fallback.length };
    }

    if (listings.length === 0) {
      return { text: `tap.az-da "${query}" tapılmadı`, count: 0 };
    }

    const lines = [`🛒 *tap.az:* "${escapeMarkdown(query)}"`, ""];
    for (let i = 0; i < listings.length; i++) {
      const l = listings[i];
      lines.push(`*${i + 1}.* ${escapeMarkdown(l.title)}`);
      lines.push(`   💰 *${l.price} AZN* | 📍 ${l.region}`);
      lines.push(`   ${l.url}`);
      lines.push("");
    }

    return { text: lines.join("\n"), count: listings.length };
  });
});

// /turbo [make] [max_price] [min_year]
bot.onText(/\/turbo(?:\s+(.*))?/, async (msg, match) => {
  const args = (match?.[1] || "").trim().split(/\s+/).filter(Boolean);
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  let make: string | undefined;
  let maxPrice: number | undefined;
  let minYear: number | undefined;

  for (const arg of args) {
    if (/^\d{4}$/.test(arg) && parseInt(arg) >= 1980) {
      minYear = parseInt(arg);
    } else if (/^\d+$/.test(arg)) {
      maxPrice = parseInt(arg);
    } else {
      make = arg;
    }
  }

  const queryDesc = [make, maxPrice ? `<${maxPrice} AZN` : null, minYear ? `>${minYear}` : null]
    .filter(Boolean)
    .join(", ") || "bütün maşınlar";

  await trackAndReply(msg.chat.id, userId, username, "turboaz", queryDesc, async () => {
    const result = await searchTurboAz({
      make,
      maxPrice,
      minYear,
      currency: "AZN",
      sort: "price_asc",
    });

    if (result.cars.length === 0) {
      return { text: `turbo.az-da heç bir avtomobil tapılmadı`, count: 0 };
    }

    const lines = [`🚗 *turbo.az:* ${escapeMarkdown(queryDesc)}`, `_${result.totalCount} ümumi elan_`, ""];
    for (let i = 0; i < Math.min(result.cars.length, 10); i++) {
      const c = result.cars[i];
      lines.push(`*${i + 1}.* ${escapeMarkdown(c.name)} (${c.year})`);
      lines.push(`   💰 *${c.price.toLocaleString()} ${c.currency}* | 📍 ${c.region}`);
      lines.push(`   ${c.url}`);
      lines.push("");
    }

    return { text: lines.join("\n"), count: result.cars.length };
  });
});

// /bina [rent] [min_price] [max_price] [min_area]
// /bina rent 200 500 — rent between 200-500 AZN
// /bina rent 300 — rent, min 300 AZN (filters daily rentals)
// /bina 50000 100000 80 — sale 50k-100k, min 80m²
bot.onText(/\/bina(?:\s+(.*))?/, async (msg, match) => {
  const args = (match?.[1] || "").trim().split(/\s+/).filter(Boolean);
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  let isRent = false;
  const numbers: number[] = [];

  for (const arg of args) {
    if (arg.toLowerCase() === "rent" || arg.toLowerCase() === "kirayə" || arg.toLowerCase() === "kiraye") {
      isRent = true;
    } else if (/^\d+$/.test(arg)) {
      numbers.push(parseInt(arg));
    }
  }

  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let minArea: number | undefined;

  if (isRent) {
    // /bina rent — all monthly rentals (min 100 AZN)
    // /bina rent 500 — max 500 AZN, min 100 AZN
    // /bina rent 200 500 — 200-500 AZN
    // /bina rent 200 500 40 — 200-500 AZN, min 40m²
    minPrice = 300; // filter daily rentals (usually 50-200 AZN/day)
    if (numbers.length === 1) {
      maxPrice = numbers[0];
    } else if (numbers.length === 2) {
      minPrice = numbers[0];
      maxPrice = numbers[1];
    } else if (numbers.length >= 3) {
      minPrice = numbers[0];
      maxPrice = numbers[1];
      minArea = numbers[2];
    }
  } else {
    // /bina 100000 — max price
    // /bina 50000 100000 — min-max price
    // /bina 50000 100000 80 — price range + min area
    if (numbers.length === 1) {
      maxPrice = numbers[0];
    } else if (numbers.length === 2) {
      minPrice = numbers[0];
      maxPrice = numbers[1];
    } else if (numbers.length >= 3) {
      minPrice = numbers[0];
      maxPrice = numbers[1];
      minArea = numbers[2];
    }
  }

  const typeLabel = isRent ? "Kirayə" : "Satılır";
  const priceDesc = minPrice && maxPrice
    ? `${minPrice}-${maxPrice} AZN`
    : maxPrice
      ? `<${maxPrice} AZN`
      : minPrice
        ? `>${minPrice} AZN`
        : null;
  const queryDesc = [typeLabel, priceDesc, minArea ? `>${minArea}m²` : null]
    .filter(Boolean)
    .join(", ");

  await trackAndReply(msg.chat.id, userId, username, "binaaz", queryDesc, async () => {
    const properties = await searchBinaAz({
      leased: isRent,
      minPrice,
      maxPrice,
      minArea,
      sort: "PRICE_ASC",
      limit: 10,
    });

    if (properties.length === 0) {
      return { text: `bina.az-da heç bir əmlak tapılmadı`, count: 0 };
    }

    const lines = [`🏠 *bina.az:* ${escapeMarkdown(queryDesc)}`, ""];
    for (let i = 0; i < properties.length; i++) {
      const p = properties[i];
      lines.push(`*${i + 1}.* ${escapeMarkdown(p.location || "?")}${p.city ? `, ${p.city}` : ""}`);
      lines.push(`   💰 *${p.price.toLocaleString()} ${p.currency}* | 🏠 ${p.rooms ?? "-"} otaq | 📐 ${p.area}m²`);
      lines.push(`   ${p.hasRepair ? "✅ Təmirli" : "❌ Təmirsiz"} | ${p.url}`);
      lines.push("");
    }

    return { text: lines.join("\n"), count: properties.length };
  });
});

// /extract <url>
bot.onText(/\/extract\s+(https?:\/\/.+)/, async (msg, match) => {
  const url = match?.[1] || "";
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  await trackAndReply(msg.chat.id, userId, username, "extract", url, async () => {
    const result = await extractContent(url);

    if (!result.success) {
      return { text: `Səhifəni oxumaq mümkün olmadı: ${result.error}`, count: 0 };
    }

    const content = result.content.substring(0, 3000);
    const lines = [
      `📄 *${escapeMarkdown(result.title || "Untitled")}*`,
      `${url}`,
      "",
      escapeMarkdown(content),
    ];

    if (content.length >= 3000) {
      lines.push("\n_... kəsildi ..._");
    }

    return { text: lines.join("\n"), count: 1 };
  });
});

// /stats
bot.onText(/\/stats/, async (msg) => {
  const statsMsg = formatStatsMessage();
  await bot.sendMessage(msg.chat.id, statsMsg, { parse_mode: "Markdown" });
});

// Smart search patterns for auto-detection
const CAR_KEYWORDS = ["maşın", "avtomobil", "car", "mercedes", "bmw", "toyota", "hyundai", "kia", "ford", "chevrolet", "lexus", "audi", "volkswagen", "nissan", "honda", "mazda", "opel", "peugeot", "renault", "vaz", "lada"];
const PROPERTY_KEYWORDS = ["mənzil", "ev", "villa", "torpaq", "ofis", "kirayə", "rent", "apartment", "house", "kiraye", "menzil"];
const PRODUCT_KEYWORDS = ["iphone", "samsung", "xiaomi", "laptop", "komputer", "telefon", "ssd", "notebook", "macbook", "airpods", "playstation", "ps5", "monitor", "printer", "televizor", "saat", "watch"];

function detectSearchType(query: string): "car" | "property" | "product" | "web" {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);

  if (CAR_KEYWORDS.some((k) => words.includes(k) || lower.includes(k))) return "car";
  if (PROPERTY_KEYWORDS.some((k) => words.includes(k) || lower.includes(k))) return "property";
  if (PRODUCT_KEYWORDS.some((k) => words.includes(k) || lower.includes(k))) return "product";
  return "web";
}

// plain text: smart global search
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/") || !msg.text) return;

  const rawQuery = msg.text.trim();
  if (rawQuery.length < 2) return;

  const query = normalizeQuery(rawQuery);
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  const searchType = detectSearchType(query);

  if (searchType === "product") {
    await trackAndReply(msg.chat.id, userId, username, "smart_tapaz", query, async () => {
      const rawListings = await searchTapAz(query, {
        maxResults: 30,
        sortByPrice: "asc",
        minPrice: 50,
      });

      const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      const listings = rawListings.filter((l) => {
        const t = l.title.toLowerCase();
        return queryWords.every((w) => t.includes(w));
      }).slice(0, 10);

      const results = listings.length > 0 ? listings : rawListings.slice(0, 10);
      const label = listings.length > 0 ? "" : " (oxşar nəticələr)";

      if (results.length === 0) {
        return { text: `"${query}" üçün tap.az-da nəticə tapılmadı`, count: 0 };
      }

      const lines = [`🛒 *tap.az:* "${escapeMarkdown(query)}"${label}`, ""];
      for (let i = 0; i < results.length; i++) {
        const l = results[i];
        lines.push(`*${i + 1}.* ${escapeMarkdown(l.title)}`);
        lines.push(`   💰 *${l.price} AZN* | 📍 ${l.region}`);
        lines.push(`   ${l.url}`);
        lines.push("");
      }
      return { text: lines.join("\n"), count: results.length };
    });
  } else if (searchType === "car") {
    await trackAndReply(msg.chat.id, userId, username, "smart_turboaz", query, async () => {
      const words = query.toLowerCase().split(/\s+/);
      let make: string | undefined;
      let maxPrice: number | undefined;

      for (const w of words) {
        if (CAR_KEYWORDS.includes(w) && !["maşın", "avtomobil", "car"].includes(w)) {
          make = w;
        } else if (/^\d+$/.test(w) && parseInt(w) >= 100) {
          maxPrice = parseInt(w);
        }
      }

      const result = await searchTurboAz({ make, maxPrice, currency: "AZN", sort: "price_asc" });

      if (result.cars.length === 0) {
        return { text: `turbo.az-da heç bir avtomobil tapılmadı`, count: 0 };
      }

      const lines = [`🚗 *turbo.az:* "${escapeMarkdown(query)}"`, `_${result.totalCount} ümumi elan_`, ""];
      for (let i = 0; i < Math.min(result.cars.length, 10); i++) {
        const c = result.cars[i];
        lines.push(`*${i + 1}.* ${escapeMarkdown(c.name)} (${c.year})`);
        lines.push(`   💰 *${c.price.toLocaleString()} ${c.currency}* | 📍 ${c.region}`);
        lines.push(`   ${c.url}`);
        lines.push("");
      }
      return { text: lines.join("\n"), count: result.cars.length };
    });
  } else if (searchType === "property") {
    await trackAndReply(msg.chat.id, userId, username, "smart_binaaz", query, async () => {
      const lower = query.toLowerCase();
      const isRent = lower.includes("kirayə") || lower.includes("kiraye") || lower.includes("rent");

      const properties = await searchBinaAz({
        leased: isRent,
        minPrice: isRent ? 300 : undefined,
        sort: "PRICE_ASC",
        limit: 10,
      });

      if (properties.length === 0) {
        return { text: `bina.az-da heç bir əmlak tapılmadı`, count: 0 };
      }

      const typeLabel = isRent ? "Kirayə" : "Satılır";
      const lines = [`🏠 *bina.az:* ${typeLabel}`, ""];
      for (let i = 0; i < properties.length; i++) {
        const p = properties[i];
        lines.push(`*${i + 1}.* ${escapeMarkdown(p.location || "?")}${p.city ? `, ${p.city}` : ""}`);
        lines.push(`   💰 *${p.price.toLocaleString()} ${p.currency}* | 🏠 ${p.rooms ?? "-"} otaq | 📐 ${p.area}m²`);
        lines.push(`   ${p.hasRepair ? "✅ Təmirli" : "❌ Təmirsiz"} | ${p.url}`);
        lines.push("");
      }
      return { text: lines.join("\n"), count: properties.length };
    });
  } else {
    await trackAndReply(msg.chat.id, userId, username, "smart_web", query, async () => {
      const results = await searchDuckDuckGo(query, 5);

      if (results.length === 0) {
        return { text: `"${query}" üçün nəticə tapılmadı`, count: 0 };
      }

      const lines = [`🔍 *"${escapeMarkdown(query)}"*`, ""];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push(`*${i + 1}.* ${escapeMarkdown(r.title)}`);
        lines.push(`${r.url}`);
        if (r.snippet) lines.push(`_${escapeMarkdown(r.snippet.substring(0, 100))}_`);
        lines.push("");
      }
      return { text: lines.join("\n"), count: results.length };
    });
  }
});

console.log("🤖 Deep Search Telegram Bot is running...");

export { bot };
