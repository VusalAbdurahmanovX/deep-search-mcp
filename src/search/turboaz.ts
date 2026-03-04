const TURBO_API = "https://turbo.az/api/v2/autos";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface TurboAzCar {
  id: number;
  name: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: string;
  mileage: string;
  fuelType: string;
  region: string;
  url: string;
  imageUrl: string;
  updatedAt: string;
}

interface TurboApiResponse {
  ads_count?: number;
  ads?: TurboApiCar[];
  auto?: TurboApiCar[];
  vips?: TurboApiCar[];
}

interface TurboApiCar {
  id: number;
  name?: string;
  make?: { id: number; name: string };
  model?: { id: number; name: string };
  year?: number;
  price?: number;
  currency?: string;
  mileage_text?: string;
  fuel_type?: string;
  region?: { id: number; name: string };
  image?: { url: string };
  updated_at?: string;
}

function parseCar(car: TurboApiCar): TurboAzCar {
  return {
    id: car.id,
    name: car.name || `${car.make?.name || ""} ${car.model?.name || ""}`.trim(),
    make: car.make?.name || "",
    model: car.model?.name || "",
    year: car.year || 0,
    price: car.price || 0,
    currency: car.currency || "AZN",
    mileage: car.mileage_text || "",
    fuelType: car.fuel_type || "",
    region: car.region?.name || "",
    url: `https://turbo.az/autos/${car.id}`,
    imageUrl: car.image?.url || "",
    updatedAt: car.updated_at || "",
  };
}

export async function searchTurboAz(options: {
  make?: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  fuelType?: string;
  sort?: "price_asc" | "price_desc" | "date_desc";
  page?: number;
} = {}): Promise<{ cars: TurboAzCar[]; totalCount: number }> {
  const params = new URLSearchParams();

  if (options.make) params.set("q[make][]", options.make);
  if (options.model) params.set("q[model][]", options.model);
  if (options.minYear) params.set("q[min_year]", String(options.minYear));
  if (options.maxYear) params.set("q[max_year]", String(options.maxYear));
  if (options.minPrice) params.set("q[min_price]", String(options.minPrice));
  if (options.maxPrice) params.set("q[max_price]", String(options.maxPrice));
  if (options.currency) params.set("q[currency]", options.currency);
  if (options.fuelType) params.set("q[fuel_type][]", options.fuelType);
  if (options.sort) params.set("q[sort]", options.sort);
  if (options.page) params.set("page", String(options.page));

  const response = await fetch(`${TURBO_API}?${params}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`turbo.az API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as TurboApiResponse;
  const allCars = [...(data.vips || []), ...(data.ads || []), ...(data.auto || [])];

  return {
    cars: allCars.map(parseCar),
    totalCount: data.ads_count || allCars.length,
  };
}

export async function checkTurboAzAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${TURBO_API}?page=1`, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
