import type { JobPhoto } from "../domain";

type StoredPhoto = { file: Blob; capturedAt: string };
function openPhotos(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dirty-turf-device-photos", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Photo storage is unavailable. Close other app tabs and retry."));
  });
}
async function photoTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openPhotos();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("photos", mode);
      const request = action(transaction.objectStore("photos"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Photos could not be saved."));
    });
  } finally { database.close(); }
}
export async function saveLocalPropertyPhotos(jobId: number, files: File[]): Promise<JobPhoto[]> {
  const current = await photoTransaction<StoredPhoto[] | undefined>("readonly", store => store.get(jobId)) ?? [];
  const photos = [...current, ...files.map(file => ({ file, capturedAt: new Date().toISOString() }))];
  // Derive previews before committing so an unreadable file cannot be reported as an unsaved duplicate.
  const previews = await Promise.all(photos.map(localPhotoPreview));
  await photoTransaction("readwrite", store => store.put(photos, jobId));
  return previews;
}
export async function loadLocalPropertyPhotos(jobId: number): Promise<JobPhoto[]> {
  const photos = await photoTransaction<StoredPhoto[] | undefined>("readonly", store => store.get(jobId)) ?? [];
  return Promise.all(photos.map(localPhotoPreview));
}
async function localPhotoPreview(photo: StoredPhoto): Promise<JobPhoto> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(photo.file);
  });
  return { url, capturedAt: photo.capturedAt, kind: "site" };
}
