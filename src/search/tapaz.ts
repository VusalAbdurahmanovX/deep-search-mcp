const TAPAZ_GRAPHQL = "https://tap.az/graphql";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface TapAzListing {
  title: string;
  price: number;
  region: string;
  url: string;
  date: string;
  imageUrl: string;
}

interface TapAzAdNode {
  title: string;
  price: number;
  region: string;
  updatedAt: string;
  path: string;
  photo: { url: string } | null;
}

interface TapAzAdsResponse {
  data?: {
    ads?: {
      edges: { node: TapAzAdNode }[];
    };
  };
  errors?: { message: string }[];
}

interface TapAzCategoryResponse {
  data?: {
    category?: { id: string; name: string };
  };
}

const KNOWN_CATEGORIES: Record<string, string> = {
  "elektronika": "Z2lkOi8vdGFwL0NhdGVnb3J5LzYyMQ",
  "komputer-aksesuarlari": "Z2lkOi8vdGFwL0NhdGVnb3J5LzYxMg",
  "komputer-avadanliqi": "Z2lkOi8vdGFwL0NhdGVnb3J5LzU4MQ",
  "telefonlar": "Z2lkOi8vdGFwL0NhdGVnb3J5LzYxOQ",
};

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(TAPAZ_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`tap.az GraphQL returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function resolveCategoryId(categoryPath: string): Promise<string | null> {
  const shortKey = categoryPath.replace(/^elanlar\/(elektronika\/)?/, "");
  if (KNOWN_CATEGORIES[shortKey]) return KNOWN_CATEGORIES[shortKey];

  const fullPath = categoryPath.startsWith("elanlar/") ? categoryPath : `elanlar/${categoryPath}`;

  try {
    const data = await gql<TapAzCategoryResponse>(`
      query { category(path: "${fullPath}") { id name } }
    `);
    return data.data?.category?.id || null;
  } catch {
    return null;
  }
}

export async function searchTapAz(
  keywords: string,
  options: {
    categoryId?: string;
    categoryPath?: string;
    maxResults?: number;
    sortByPrice?: "asc" | "desc";
    minPrice?: number;
    maxPrice?: number;
  } = {}
): Promise<TapAzListing[]> {
  const { maxResults = 20, sortByPrice = "asc" } = options;
  let { categoryId } = options;

  if (!categoryId && options.categoryPath) {
    categoryId = (await resolveCategoryId(options.categoryPath)) || undefined;
  }

  const orderType = sortByPrice === "desc" ? "PRICE_DESC" : "PRICE_ASC";

  const filterParts: string[] = [];
  if (categoryId) filterParts.push(`categoryId: "${categoryId}"`);
  if (options.minPrice !== undefined || options.maxPrice !== undefined) {
    const priceParts: string[] = [];
    if (options.minPrice !== undefined) priceParts.push(`from: ${options.minPrice}`);
    if (options.maxPrice !== undefined) priceParts.push(`to: ${options.maxPrice}`);
    filterParts.push(`price: { ${priceParts.join(", ")} }`);
  }
  const filterClause = filterParts.length > 0 ? `filters: { ${filterParts.join(", ")} }` : "";

  const query = `
    query {
      ads(
        keywords: "${keywords.replace(/"/g, '\\"')}"
        source: DESKTOP
        orderType: ${orderType}
        ${filterClause}
        first: ${maxResults}
      ) {
        edges {
          node {
            title
            price
            region
            updatedAt
            path
            photo { url }
          }
        }
      }
    }
  `;

  const data = await gql<TapAzAdsResponse>(query);

  if (data.errors?.length) {
    throw new Error(`tap.az API error: ${data.errors.map((e) => e.message).join(", ")}`);
  }

  const edges = data.data?.ads?.edges || [];

  return edges.map(({ node }) => ({
    title: node.title,
    price: node.price,
    region: node.region || "",
    url: `https://tap.az${node.path}`,
    date: node.updatedAt?.split("T")[0] || "",
    imageUrl: node.photo?.url ? `https://tap.azstatic.com${node.photo.url}` : "",
  }));
}

export async function checkTapAzAvailable(): Promise<boolean> {
  try {
    const data = await gql<{ data?: { __schema?: unknown } }>(`
      query { __schema { queryType { name } } }
    `);
    return !!data.data?.__schema;
  } catch {
    return false;
  }
}
