const BINA_GRAPHQL = "https://bina.az/graphql";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface BinaAzProperty {
  id: string;
  rooms: number | null;
  floor: number | null;
  price: number;
  currency: string;
  area: number;
  location: string;
  city: string;
  hasRepair: boolean;
  hasMortgage: boolean;
  url: string;
  imageUrl: string;
  updatedAt: string;
}

interface BinaGqlResponse {
  data?: {
    items?: BinaGqlItem[];
  };
  errors?: { message: string }[];
}

interface BinaGqlItem {
  id: string;
  rooms: number | null;
  floor: number | null;
  path: string;
  updatedAt: string;
  hasRepair: boolean;
  hasMortgage: boolean;
  price: { value: number; currency: string };
  area: { value: number };
  location: { name: string; path: string };
  city: { name: string };
  photos: { large: string }[];
}

async function gql<T>(query: string): Promise<T> {
  const response = await fetch(BINA_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`bina.az GraphQL returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function searchBinaAz(options: {
  leased?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minArea?: number;
  maxArea?: number;
  rooms?: number;
  cityId?: number;
  hasRepair?: boolean;
  hasMortgage?: boolean;
  sort?: "PRICE_ASC" | "PRICE_DESC" | "AREA_ASC" | "AREA_DESC";
  limit?: number;
} = {}): Promise<BinaAzProperty[]> {
  const {
    leased = false,
    sort = "PRICE_ASC",
    limit = 20,
  } = options;

  const filters: string[] = [`leased: ${leased}`];
  if (options.minPrice !== undefined) filters.push(`priceFrom: ${options.minPrice}`);
  if (options.maxPrice !== undefined) filters.push(`priceTo: ${options.maxPrice}`);
  if (options.minArea !== undefined) filters.push(`areaFrom: ${options.minArea}`);
  if (options.maxArea !== undefined) filters.push(`areaTo: ${options.maxArea}`);
  if (options.hasRepair !== undefined) filters.push(`hasRepair: ${options.hasRepair}`);
  if (options.hasMortgage !== undefined) filters.push(`hasMortgage: ${options.hasMortgage}`);
  if (options.cityId !== undefined) filters.push(`cityId: ${options.cityId}`);

  const query = `{
    items(
      limit: ${limit}
      filter: { ${filters.join(", ")} }
      sort: ${sort}
    ) {
      id
      rooms
      floor
      path
      updatedAt
      hasRepair
      hasMortgage
      price { value currency }
      area { value }
      location { name path }
      city { name }
      photos { large }
    }
  }`;

  const data = await gql<BinaGqlResponse>(query);

  if (data.errors?.length) {
    throw new Error(`bina.az error: ${data.errors.map((e) => e.message).join(", ")}`);
  }

  return (data.data?.items || []).map((item) => ({
    id: item.id,
    rooms: item.rooms,
    floor: item.floor,
    price: item.price?.value || 0,
    currency: item.price?.currency || "AZN",
    area: item.area?.value || 0,
    location: item.location?.name || "",
    city: item.city?.name || "",
    hasRepair: item.hasRepair,
    hasMortgage: item.hasMortgage,
    url: `https://bina.az${item.path}`,
    imageUrl: item.photos?.[0]?.large || "",
    updatedAt: item.updatedAt?.split("T")[0] || "",
  }));
}

export async function checkBinaAzAvailable(): Promise<boolean> {
  try {
    const data = await gql<{ data?: { __schema?: unknown } }>(
      `{ __schema { queryType { name } } }`
    );
    return !!data.data?.__schema;
  } catch {
    return false;
  }
}
