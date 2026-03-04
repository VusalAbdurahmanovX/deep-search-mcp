import TelegramBot from "node-telegram-bot-api";
import { searchTapAz } from "../search/tapaz.js";
import { searchTurboAz } from "../search/turboaz.js";
import { searchBinaAz } from "../search/binaaz.js";
import { searchDuckDuckGo } from "../search/duckduckgo.js";
import { extractContent } from "../scraper/extractor.js";
import { recordSearch, formatStatsMessage } from "../stats/stats.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const pendingSearches = new Map<number, { query: string; source?: string }>();

function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function normalizeQuery(q: string): string {
  return q.replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2").trim();
}

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🔍 *Deep Search Bot*\n\nSadəcə axtarmaq istədiyinizi yazın\\!\n\nMəsələn:\n• `iPhone 15`\n• `laptop`\n• `Mercedes`\n• `mənzil kirayə`\n\nVə ya `/help` əmrindən istifadə edin\\.",
    { parse_mode: "MarkdownV2" }
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "📋 *Əmrlər:*\n\nSorğunuzu yazın → mənbə seçin → qiymət seçin → nəticələr\\!\n\n`/stats` \\- Statistika\n`/extract <URL>` \\- Səhifəni oxu\n`/help` \\- Bu mesaj",
    { parse_mode: "MarkdownV2" }
  );
});

// /stats
bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(msg.chat.id, formatStatsMessage(), { parse_mode: "Markdown" });
});

// /extract
bot.onText(/\/extract\s+(https?:\/\/.+)/, async (msg, match) => {
  const url = match?.[1] || "";
  await bot.sendChatAction(msg.chat.id, "typing");
  const result = await extractContent(url);
  if (!result.success) {
    bot.sendMessage(msg.chat.id, `Xəta: ${result.error}`);
    return;
  }
  const content = result.content.substring(0, 3000);
  bot.sendMessage(msg.chat.id, `📄 *${esc(result.title || "Untitled")}*\n\n${esc(content)}${content.length >= 3000 ? "\n\n_\\.\\.\\. kəsildi \\.\\.\\._" : ""}`, { parse_mode: "MarkdownV2", disable_web_page_preview: true });
});

// Plain text → Step 1: Show source selection
bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const query = normalizeQuery(msg.text.trim());
  if (query.length < 2) return;

  pendingSearches.set(msg.chat.id, { query });

  bot.sendMessage(msg.chat.id, `🔍 *"${esc(query)}"* — Harada axtarım?`, {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🛒 tap.az", callback_data: `src:tapaz` },
          { text: "🚗 turbo.az", callback_data: `src:turboaz` },
        ],
        [
          { text: "🏠 bina.az (Satılır)", callback_data: `src:bina_sale` },
          { text: "🏠 bina.az (Kirayə)", callback_data: `src:bina_rent` },
        ],
        [
          { text: "🌐 Web", callback_data: `src:web` },
        ],
      ],
    },
  });
});

// Step 2: Source selected → ask price or search directly
bot.on("callback_query", async (cb) => {
  const chatId = cb.message?.chat.id;
  if (!chatId || !cb.data) return;

  await bot.answerCallbackQuery(cb.id);

  const pending = pendingSearches.get(chatId);
  if (!pending) {
    bot.sendMessage(chatId, "Zəhmət olmasa yeni sorğu yazın.");
    return;
  }

  // Source selection
  if (cb.data.startsWith("src:")) {
    const source = cb.data.replace("src:", "");
    pending.source = source;

    if (source === "web") {
      await doWebSearch(chatId, pending.query);
      pendingSearches.delete(chatId);
      return;
    }

    if (source === "turboaz") {
      await doTurboSearch(chatId, pending.query);
      pendingSearches.delete(chatId);
      return;
    }

    if (source === "bina_sale" || source === "bina_rent") {
      bot.sendMessage(chatId, "💰 Maksimum qiymət seçin (AZN):", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "50,000", callback_data: "bprice:50000" },
              { text: "100,000", callback_data: "bprice:100000" },
              { text: "200,000", callback_data: "bprice:200000" },
            ],
            [
              { text: "500,000", callback_data: "bprice:500000" },
              { text: "1,000 (kirayə)", callback_data: "bprice:1000" },
              { text: "Hamısı", callback_data: "bprice:0" },
            ],
          ],
        },
      });
      return;
    }

    // tap.az: ask for min price
    bot.sendMessage(chatId, "💰 Minimum qiymət seçin (aksessuarları filtrləmək üçün):", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Heç biri (0 AZN)", callback_data: "tprice:0" },
            { text: "50 AZN", callback_data: "tprice:50" },
            { text: "100 AZN", callback_data: "tprice:100" },
          ],
          [
            { text: "200 AZN", callback_data: "tprice:200" },
            { text: "500 AZN", callback_data: "tprice:500" },
            { text: "1000 AZN", callback_data: "tprice:1000" },
          ],
        ],
      },
    });
    return;
  }

  // tap.az price selected → search
  if (cb.data.startsWith("tprice:")) {
    const minPrice = parseInt(cb.data.replace("tprice:", "")) || undefined;
    await doTapAzSearch(chatId, pending.query, minPrice);
    pendingSearches.delete(chatId);
    return;
  }

  // bina.az price selected → search
  if (cb.data.startsWith("bprice:")) {
    const maxPrice = parseInt(cb.data.replace("bprice:", "")) || undefined;
    const isRent = pending.source === "bina_rent";
    await doBinaSearch(chatId, isRent, maxPrice);
    pendingSearches.delete(chatId);
    return;
  }
});

// ── Search functions ────────────────────────────────────────────────

async function doTapAzSearch(chatId: number, query: string, minPrice?: number) {
  await bot.sendChatAction(chatId, "typing");
  const start = Date.now();

  try {
    const rawListings = await searchTapAz(query, { maxResults: 30, sortByPrice: "asc", minPrice });

    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const filtered = rawListings.filter((l) => {
      const t = l.title.toLowerCase();
      return words.every((w) => t.includes(w));
    }).slice(0, 10);

    const results = filtered.length > 0 ? filtered : rawListings.slice(0, 10);
    const label = filtered.length > 0 ? "" : " (oxşar)";

    if (results.length === 0) {
      bot.sendMessage(chatId, `tap.az-da "${query}" tapılmadı`);
      return;
    }

    const lines = [`🛒 *tap\\.az:* "${esc(query)}"${label}`, ""];
    for (let i = 0; i < results.length; i++) {
      const l = results[i];
      lines.push(`*${i + 1}\\.* ${esc(l.title)}`);
      lines.push(`   💰 *${l.price} AZN* \\| 📍 ${esc(l.region)}`);
      lines.push(`   ${esc(l.url)}`);
      lines.push("");
    }
    lines.push(`_${Date.now() - start}ms \\| ${results.length} nəticə_`);

    recordSearch({ query, tool: "tapaz", responseTimeMs: Date.now() - start, resultCount: results.length });
    bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "MarkdownV2", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(chatId, `Xəta: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

async function doTurboSearch(chatId: number, query: string) {
  await bot.sendChatAction(chatId, "typing");
  const start = Date.now();

  try {
    const words = query.toLowerCase().split(/\s+/);
    let make: string | undefined;
    let maxPrice: number | undefined;

    for (const w of words) {
      if (/^\d+$/.test(w) && parseInt(w) >= 100) {
        maxPrice = parseInt(w);
      } else if (w.length > 2 && !["car", "maşın", "avtomobil"].includes(w)) {
        make = w;
      }
    }

    const result = await searchTurboAz({ make, maxPrice, currency: "AZN", sort: "price_asc" });

    if (result.cars.length === 0) {
      bot.sendMessage(chatId, "turbo.az-da heç bir avtomobil tapılmadı");
      return;
    }

    const lines = [`🚗 *turbo\\.az* \\(${result.totalCount} ümumi\\)`, ""];
    for (let i = 0; i < Math.min(result.cars.length, 10); i++) {
      const c = result.cars[i];
      lines.push(`*${i + 1}\\.* ${esc(c.name)} \\(${c.year}\\)`);
      lines.push(`   💰 *${c.price.toLocaleString()} ${c.currency}* \\| 📍 ${esc(c.region)}`);
      lines.push(`   ${esc(c.url)}`);
      lines.push("");
    }
    lines.push(`_${Date.now() - start}ms_`);

    recordSearch({ query, tool: "turboaz", responseTimeMs: Date.now() - start, resultCount: result.cars.length });
    bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "MarkdownV2", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(chatId, `Xəta: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

async function doBinaSearch(chatId: number, isRent: boolean, maxPrice?: number) {
  await bot.sendChatAction(chatId, "typing");
  const start = Date.now();

  try {
    const properties = await searchBinaAz({
      leased: isRent,
      minPrice: isRent ? 300 : undefined,
      maxPrice: maxPrice || undefined,
      sort: "PRICE_ASC",
      limit: 10,
    });

    if (properties.length === 0) {
      bot.sendMessage(chatId, "bina.az-da heç bir əmlak tapılmadı");
      return;
    }

    const typeLabel = isRent ? "Kirayə" : "Satılır";
    const lines = [`🏠 *bina\\.az:* ${esc(typeLabel)}`, ""];
    for (let i = 0; i < properties.length; i++) {
      const p = properties[i];
      lines.push(`*${i + 1}\\.* ${esc(p.location || "?")}${p.city ? `, ${esc(p.city)}` : ""}`);
      lines.push(`   💰 *${p.price.toLocaleString()} ${p.currency}* \\| 🏠 ${p.rooms ?? "\\-"} otaq \\| 📐 ${p.area}m²`);
      lines.push(`   ${p.hasRepair ? "✅" : "❌"} \\| ${esc(p.url)}`);
      lines.push("");
    }
    lines.push(`_${Date.now() - start}ms \\| ${properties.length} nəticə_`);

    recordSearch({ query: typeLabel, tool: "binaaz", responseTimeMs: Date.now() - start, resultCount: properties.length });
    bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "MarkdownV2", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(chatId, `Xəta: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

async function doWebSearch(chatId: number, query: string) {
  await bot.sendChatAction(chatId, "typing");
  const start = Date.now();

  try {
    const results = await searchDuckDuckGo(query, 5);

    if (results.length === 0) {
      bot.sendMessage(chatId, `"${query}" üçün nəticə tapılmadı`);
      return;
    }

    const lines = [`🌐 *Web:* "${esc(query)}"`, ""];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`*${i + 1}\\.* ${esc(r.title)}`);
      lines.push(`${esc(r.url)}`);
      if (r.snippet) lines.push(`_${esc(r.snippet.substring(0, 100))}_`);
      lines.push("");
    }
    lines.push(`_${Date.now() - start}ms_`);

    recordSearch({ query, tool: "web", responseTimeMs: Date.now() - start, resultCount: results.length });
    bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "MarkdownV2", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(chatId, `Xəta: ${err instanceof Error ? err.message : "Unknown"}`);
  }
}

console.log("🤖 Deep Search Telegram Bot is running...");
export { bot };
