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
bot.onText(/\/tapaz\s+(.+)/, async (msg, match) => {
  const parts = (match?.[1] || "").trim().split(/\s+/);
  let minPrice: number | undefined;

  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart) && parts.length > 1) {
    minPrice = parseInt(lastPart);
    parts.pop();
  }

  const query = parts.join(" ");
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  await trackAndReply(msg.chat.id, userId, username, "tapaz", query, async () => {
    const listings = await searchTapAz(query, {
      maxResults: 10,
      sortByPrice: "asc",
      minPrice,
    });

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

// /bina [rent] [max_price] [min_area]
bot.onText(/\/bina(?:\s+(.*))?/, async (msg, match) => {
  const args = (match?.[1] || "").trim().split(/\s+/).filter(Boolean);
  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  let isRent = false;
  let maxPrice: number | undefined;
  let minArea: number | undefined;

  for (const arg of args) {
    if (arg.toLowerCase() === "rent" || arg.toLowerCase() === "kirayə") {
      isRent = true;
    } else if (/^\d+$/.test(arg)) {
      if (!maxPrice) {
        maxPrice = parseInt(arg);
      } else {
        minArea = parseInt(arg);
      }
    }
  }

  const typeLabel = isRent ? "Kirayə" : "Satılır";
  const queryDesc = [typeLabel, maxPrice ? `<${maxPrice} AZN` : null, minArea ? `>${minArea}m²` : null]
    .filter(Boolean)
    .join(", ");

  await trackAndReply(msg.chat.id, userId, username, "binaaz", queryDesc, async () => {
    const properties = await searchBinaAz({
      leased: isRent,
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

// plain text: auto-search
bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/") || !msg.text) return;

  const query = msg.text.trim();
  if (query.length < 2) return;

  const userId = String(msg.from?.id || msg.chat.id);
  const username = msg.from?.username;

  await trackAndReply(msg.chat.id, userId, username, "auto_search", query, async () => {
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
});

console.log("🤖 Deep Search Telegram Bot is running...");

export { bot };
