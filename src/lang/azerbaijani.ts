const AZ_SPECIFIC_CHARS = /[əğıöüçşƏĞIÖÜÇŞ]/;
const AZ_COMMON_WORDS = [
  "və", "bu", "bir", "ilə", "üçün", "olan", "olur", "edir",
  "daha", "çox", "var", "yox", "nə", "kim", "harada", "niyə",
  "necə", "hər", "belə", "ancaq", "amma", "lakin", "sonra",
  "əvvəl", "artıq", "həm", "yalnız", "bütün", "öz", "onun",
  "bizim", "sizin", "onların", "mən", "sən", "biz", "siz",
  "haqqında", "üzrə", "arasında", "kimi", "olaraq", "görə",
  "qədər", "barədə", "məsələn", "həmçinin", "əsasən",
];

const AZ_DOMAINS = [
  "az", "gov.az", "edu.az", "news.az", "baku.ws",
  "oxu.az", "report.az", "apa.az", "trend.az",
  "modern.az", "musavat.com", "azadliq.org",
  "haqqin.az", "pia.az", "yeniavaz.com",
];

const AZ_SEARCH_SUFFIXES = [
  "azərbaycanca", "azerbaycan", "bakı", "baku",
  "site:az",
];

export function detectAzerbaijani(text: string): { isAzerbaijani: boolean; confidence: number } {
  if (!text || text.length < 5) {
    return { isAzerbaijani: false, confidence: 0 };
  }

  let score = 0;
  const lower = text.toLowerCase();

  if (AZ_SPECIFIC_CHARS.test(text)) {
    score += 40;
  }

  const words = lower.split(/\s+/);
  let azWordCount = 0;
  for (const word of words) {
    if (AZ_COMMON_WORDS.includes(word)) {
      azWordCount++;
    }
  }

  if (words.length > 0) {
    const ratio = azWordCount / words.length;
    score += Math.min(ratio * 200, 40);
  }

  const azSuffixes = [
    "lar", "lər", "lıq", "lik", "lüq", "lük",
    "çı", "çi", "çu", "çü", "sız", "siz",
    "maq", "mək", "ıb", "ib", "ub", "üb",
  ];
  let suffixHits = 0;
  for (const word of words) {
    for (const suffix of azSuffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 1) {
        suffixHits++;
        break;
      }
    }
  }
  if (words.length > 0) {
    score += Math.min((suffixHits / words.length) * 100, 20);
  }

  const confidence = Math.min(score, 100) / 100;
  return {
    isAzerbaijani: confidence > 0.3,
    confidence,
  };
}

export function isAzerbaijaniDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return AZ_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

export function enhanceQueryForAz(query: string): string[] {
  const queries = [query];

  const detection = detectAzerbaijani(query);

  if (detection.isAzerbaijani) {
    queries.push(`${query} site:.az`);
  } else {
    queries.push(`${query} Azerbaijan`);
    queries.push(`${query} azərbaycanca`);
  }

  return queries;
}

export function prioritizeAzResults<T extends { url: string }>(results: T[]): T[] {
  const azResults: T[] = [];
  const otherResults: T[] = [];

  for (const r of results) {
    if (isAzerbaijaniDomain(r.url)) {
      azResults.push(r);
    } else {
      otherResults.push(r);
    }
  }

  return [...azResults, ...otherResults];
}

export function getAzSearchParams(): Record<string, string> {
  return {
    language: "az",
    region: "AZ",
  };
}
