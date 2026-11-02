import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { ADDRESS_SUGGESTION_DELAY_MS, ADDRESS_SUGGESTION_MIN_LENGTH, suggestPropertyAddresses } from "../lib/addressAutocomplete";
import type { PropertyGeocodeResult } from "../lib/mapGeocode";
import "./PropertyAddressSearch.css";

type Props = {
  value: string;
  searching: boolean;
  onChange: (value: string) => void;
  onSelect: (match: PropertyGeocodeResult) => void;
  onSearch: () => void;
  onLocate: () => void;
};

export function PropertyAddressSearch({ value, searching, onChange, onSelect, onSearch, onLocate }: Props) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PropertyGeocodeResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [message, setMessage] = useState("");
  const edited = useRef(false);
  const lastRequest = useRef(0);
  const cache = useRef(new Map<string, PropertyGeocodeResult[]>());
  const abort = useRef<AbortController | null>(null);
  const revision = useRef(0);

  const dismiss = () => {
    revision.current += 1;
    abort.current?.abort();
    setOpen(false); setLoading(false); setSuggestions([]); setActiveIndex(-1); setMessage("");
  };
  const select = (match: PropertyGeocodeResult) => { edited.current = false; dismiss(); onSelect(match); };

  useEffect(() => {
    const query = value.replace(/\s+/g, " ").trim();
    if (!focused || !edited.current || searching || query.length < ADDRESS_SUGGESTION_MIN_LENGTH || !/[a-z]/i.test(query)) return;
    let active = true;
    const request = ++revision.current;
    const controller = new AbortController();
    abort.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const key = query.toLowerCase();
    const show = (results: PropertyGeocodeResult[]) => {
      if (!active || request !== revision.current) return;
      setSuggestions(results); setActiveIndex(-1); setOpen(results.length > 0); setLoading(false);
      setMessage(results.length ? `${results.length} address ${results.length === 1 ? "suggestion" : "suggestions"}. Choose an address below.` : "Keep typing the street and city, or press Search.");
    };
    const cached = cache.current.get(key);
    if (cached) { show(cached); return () => { active = false; }; }
    // Wait for a typing pause and keep requests at least one second apart.
    const timer = setTimeout(() => {
      if (!active || request !== revision.current) return;
      lastRequest.current = Date.now(); setLoading(true); setMessage("Looking for address suggestions…");
      timeout = setTimeout(() => controller.abort(), 8_000);
      void suggestPropertyAddresses(query, controller.signal).then(results => {
        if (!active || request !== revision.current) return;
        if (cache.current.size >= 40) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, results); show(results);
      }).catch(() => {
        if (!active || request !== revision.current) return;
        setLoading(false); setOpen(false); setMessage("Suggestions are unavailable. Enter the full address and press Search.");
      }).finally(() => clearTimeout(timeout));
    }, Math.max(ADDRESS_SUGGESTION_DELAY_MS, 1_000 - (Date.now() - lastRequest.current)));
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [value, focused, searching]);

  return <div className="property-address-search">
    <div className="map-search-row">
      <label htmlFor={`${id}-input`}><span className="sr-only">Property address</span>
        <input id={`${id}-input`} value={value} maxLength={180} placeholder="Start typing a property address" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-describedby={`${id}-help`} aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); dismiss(); }}
          onChange={event => { dismiss(); edited.current = true; setFocused(true); onChange(event.target.value); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => (index + 1) % suggestions.length); }
            else if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => index <= 0 ? suggestions.length - 1 : index - 1); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); edited.current = false; dismiss(); }
            else if (event.key === "Enter") { event.preventDefault(); if (open && activeIndex >= 0) select(suggestions[activeIndex]); else { edited.current = false; dismiss(); onSearch(); } }
          }} />
      </label>
      <button type="button" onClick={() => { edited.current = false; dismiss(); onSearch(); }} aria-label="Search address" disabled={searching}><Search size={17} /></button>
      <button type="button" onClick={() => { edited.current = false; dismiss(); onLocate(); }} aria-label="Use current location"><LocateFixed size={17} /></button>
    </div>
    {open && <ul className="property-address-options" id={`${id}-options`} role="listbox" aria-label="Address suggestions">{suggestions.map((match, index) => <li role="option" id={`${id}-option-${index}`} key={`${match.formattedAddress}:${match.latitude}:${match.longitude}`} aria-selected={index === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => select(match)}><MapPin size={18} aria-hidden="true" /><span>{match.formattedAddress}</span></li>)}</ul>}
    <p id={`${id}-help`} className="property-address-help" role="status" aria-live="polite" aria-busy={loading}>{message || "Type a street number and street, then choose an address or press Search."}</p>
    <small className="map-geocode-attribution">Suggestions by Photon / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></small>
  </div>;
}
