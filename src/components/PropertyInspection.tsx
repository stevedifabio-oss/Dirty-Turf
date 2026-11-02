import { Camera, ImagePlus, X } from "lucide-react";
import type { TurfInspection } from "../domain";
import { inspectionChoices, inspectionLabel, MAX_PROPERTY_PHOTOS, propertyPhotoTypes, validatePropertyPhotos } from "../lib/turfInspection";
import "./property-inspection.css";

export type PendingPropertyPhoto = { id: string; file: File; url: string };

export function PropertyInspection({ value, onChange, photos, onPhotosChange, onError }: {
  value: TurfInspection; onChange: (value: TurfInspection) => void;
  photos: PendingPropertyPhoto[]; onPhotosChange: (photos: PendingPropertyPhoto[]) => void; onError: (message: string) => void;
}) {
  const addPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    try {
      validatePropertyPhotos(files, photos.length);
      onPhotosChange([...photos, ...files.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
    } catch (error) { onError(error instanceof Error ? error.message : "Photos could not be added."); }
  };
  return <section className="property-inspection" aria-labelledby="inspection-title">
    <div className="inspection-heading"><div><p>Optional yard inspection</p><h3 id="inspection-title">What are you working with?</h3></div><span>Save with this measurement</span></div>
    {(Object.keys(inspectionChoices) as (keyof typeof inspectionChoices)[]).map(key => {
      const field = inspectionChoices[key];
      return <fieldset className="inspection-choice" key={key}><legend>{field.label}</legend><div>{field.options.map(option => <label key={option} className={value[key] === option ? "selected" : ""}><input type="radio" name={`inspection-${key}`} value={option} checked={value[key] === option} onChange={() => onChange({ ...value, [key]: option })} />{inspectionLabel(option)}</label>)}{value[key] && <button type="button" className="inspection-clear" aria-label={`Clear ${field.label.toLowerCase()}`} onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}>Clear</button>}</div></fieldset>;
    })}
    <label className="inspection-notes">Notes<textarea rows={3} maxLength={2000} value={value.notes ?? ""} onChange={event => onChange({ ...value, notes: event.target.value })} placeholder="Stains, odors, damaged edges, or anything to revisit…" /><small>{value.notes?.length ?? 0}/2,000</small></label>
    <div className="inspection-heading"><h3>Property photos</h3><span>{photos.length}/{MAX_PROPERTY_PHOTOS}</span></div>
    <p className="inspection-help">Show the turf and any problem areas. Up to six photos, 20 MB each.</p>
    <div className="inspection-photo-actions"><label className="secondary-button"><Camera size={17} /> Take photo<input className="sr-only" type="file" accept={propertyPhotoTypes.join(",")} capture="environment" disabled={photos.length >= MAX_PROPERTY_PHOTOS} onChange={addPhotos} /></label><label className="secondary-button"><ImagePlus size={17} /> Upload photos<input className="sr-only" type="file" accept={propertyPhotoTypes.join(",")} multiple disabled={photos.length >= MAX_PROPERTY_PHOTOS} onChange={addPhotos} /></label></div>
    {photos.length > 0 && <ul className="inspection-photo-grid">{photos.map((photo, index) => <li key={photo.id}><img src={photo.url} alt={`Selected turf photo ${index + 1}`} /><button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => onPhotosChange(photos.filter(item => item.id !== photo.id))}><X size={17} /></button><span>{photo.file.name}</span></li>)}</ul>}
  </section>;
}

export function SavedInspection({ inspection }: { inspection?: TurfInspection }) {
  if (!inspection || !Object.keys(inspection).length) return <section className="property-inspection"><h3>Yard inspection</h3><p className="inspection-help">No inspection was recorded for this measurement.</p></section>;
  return <section className="property-inspection"><h3>Yard inspection</h3><dl className="saved-inspection">{(Object.keys(inspectionChoices) as (keyof typeof inspectionChoices)[]).map(key => <div key={key}><dt>{inspectionChoices[key].label}</dt><dd>{inspection[key] ? inspectionLabel(inspection[key]) : "Not recorded"}</dd></div>)}</dl>{inspection.notes && <div className="saved-inspection-notes"><h4>Notes</h4><p>{inspection.notes}</p></div>}</section>;
}
