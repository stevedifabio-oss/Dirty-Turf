import { Capacitor, registerPlugin } from "@capacitor/core";

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

type NativeDirtyTurfMeasurePlugin = {
  isAvailable: () => Promise<{ available: boolean }>;
  startAreaMeasurement: () => Promise<LiveMeasurementResult>;
};

const nativeMeasure = registerPlugin<NativeDirtyTurfMeasurePlugin>("DirtyTurfMeasure");

export async function hasNativeLiveMeasurement() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await nativeMeasure.isAvailable();
    return result.available;
  } catch {
    return false;
  }
}

export async function startNativeLiveMeasurement() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Live AR measurement is available in the iPhone and Android app build.");
  }

  const result = await nativeMeasure.startAreaMeasurement();
  if (!Number.isFinite(result.areaSquareFeet) || result.areaSquareFeet <= 0 || result.points.length < 3) {
    throw new Error("The live measurement did not return a valid closed boundary.");
  }
  return result;
}
