export type LiveMeasurementPoint = {
  x: number;
  y: number;
  z: number;
};

export type LiveMeasurementResult = {
  areaSquareFeet: number;
  perimeterFeet: number;
  points: LiveMeasurementPoint[];
  capturedAt: string;
};

type DirtyTurfMeasureBridge = {
  isAvailable: () => Promise<boolean>;
  startAreaMeasurement: () => Promise<LiveMeasurementResult>;
};

declare global {
  interface Window {
    DirtyTurfMeasure?: DirtyTurfMeasureBridge;
  }
}

export async function hasNativeLiveMeasurement() {
  if (!window.DirtyTurfMeasure) return false;
  try {
    return await window.DirtyTurfMeasure.isAvailable();
  } catch {
    return false;
  }
}

export async function startNativeLiveMeasurement() {
  if (!window.DirtyTurfMeasure) {
    throw new Error("Live AR measurement is available in the iPhone and Android app build.");
  }

  const result = await window.DirtyTurfMeasure.startAreaMeasurement();
  if (!Number.isFinite(result.areaSquareFeet) || result.areaSquareFeet <= 0 || result.points.length < 3) {
    throw new Error("The live measurement did not return a valid closed boundary.");
  }
  return result;
}
