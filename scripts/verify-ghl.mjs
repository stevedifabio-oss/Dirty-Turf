import { readFile } from "node:fs/promises";

const secretFile = new URL("../.env.supabase", import.meta.url);
const fileValues = await readSecretFile(secretFile);
const locationId = process.env.GHL_LOCATION_ID ?? fileValues.GHL_LOCATION_ID;
const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN ??
  fileValues.GHL_PRIVATE_INTEGRATION_TOKEN;

if (!locationId || !token) {
  console.error("Missing GHL_LOCATION_ID or GHL_PRIVATE_INTEGRATION_TOKEN.");
  process.exit(1);
}

const headers = {
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
  Version: "v3",
};
const base = "https://services.leadconnectorhq.com";

const [location, pipelines, workflows, products] = await Promise.all([
  request(`/locations/${encodeURIComponent(locationId)}`),
  request(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  ),
  request(`/workflows/?locationId=${encodeURIComponent(locationId)}`),
  request(`/products/?locationId=${encodeURIComponent(locationId)}&limit=1`),
]);

const locationRecord = location.location ?? location;
console.log(`HighLevel location: ${locationRecord.name ?? "Unknown"}`);
console.log(
  `Location ID matches: ${locationRecord.id === locationId ? "yes" : "no"}`,
);
console.log(
  `Pipelines accessible: ${
    Array.isArray(pipelines.pipelines) ? pipelines.pipelines.length : 0
  }`,
);
console.log(
  `Workflows accessible: ${
    Array.isArray(workflows.workflows) ? workflows.workflows.length : 0
  }`,
);
console.log(
  `Product metadata accessible: ${
    Array.isArray(products.products) ? "yes" : "no"
  }`,
);

async function request(path) {
  const response = await fetch(`${base}${path}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(
      `HighLevel verification failed for ${
        path.split("?")[0]
      } (${response.status}).`,
    );
  }
  return response.json();
}

async function readSecretFile(url) {
  try {
    const text = await readFile(url, "utf8");
    return Object.fromEntries(
      text.split(/\r?\n/).filter(Boolean).map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}
