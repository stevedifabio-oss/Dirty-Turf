import { useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, ChevronRight, MapPin, MessageSquare, Search, Users, X } from "lucide-react";
import type { CommunityPost } from "../domain";
import { postSearchResult, rankSearchResults, searchContent, type GlobalSearchResult, type SearchContent, type SearchTarget } from "../lib/globalSearch";

type Props = { query: string; onQuery: (query: string) => void; content: SearchContent; readOnly: boolean; searchRemote?: (query: string) => Promise<CommunityPost[]>; onOpen: (target: SearchTarget) => void };
export function GlobalSearch({ query, onQuery, content, readOnly, searchRemote, onOpen }: Props) {
  const [remote, setRemote] = useState<{ query: string; rows: GlobalSearchResult[] }>();
  const [state, setState] = useState<"ready" | "loading" | "error">("ready");
  const [retry, setRetry] = useState(0);
  const normalized = query.trim();
  useEffect(() => {
    let active = true;
    setRemote(undefined); setState("ready");
    if (!searchRemote || readOnly || normalized.length < 2) return;
    setState("loading");
    const timer = window.setTimeout(() => {
      void searchRemote(normalized).then(posts => {
        if (active) { setRemote({ query: normalized, rows: posts.map(postSearchResult) }); setState("ready"); }
      }).catch(() => { if (active) setState("error"); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [normalized, readOnly, searchRemote, retry]);
  const local = useMemo(() => searchContent(content, normalized), [content, normalized]);
  const results = normalized ? rankSearchResults([...local, ...(remote?.query === normalized ? remote.rows : [])], normalized) : local;
  return <section className="search-view">
    <label className="search-input"><Search size={19} /><span className="sr-only">Search the Academy, Community, members, events and properties</span><input autoFocus maxLength={120} value={query} onChange={event => onQuery(event.target.value)} placeholder="Search the workspace" />{query && <button onClick={() => onQuery("")} aria-label="Clear search"><X size={16} /></button>}</label>
    <p className="result-count" role="status">{normalized ? `${results.length === 40 ? "Showing up to 40" : results.length} matches${state === "loading" ? " · searching older posts…" : ""}` : "Recent content · type to search courses, lessons and discussions"}</p>
    {readOnly && <p className="search-note">Searching loaded content. Reconnect to search older posts.</p>}
    {!readOnly && <p className="search-note">Searching available courses and loaded workspace content{searchRemote ? ", plus older Community posts. Older comments appear when their threads are loaded." : "."}</p>}
    {state === "error" && <div className="cloud-load-alert" role="alert"><span>Older posts could not be searched. Loaded matches are still available.</span><button onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    <div className="search-results">{results.map(item => <button className="result-row" key={item.key} onClick={() => onOpen(item.target)}><span className="result-icon">{item.type === "Property" ? <MapPin size={18} /> : item.type === "Event" ? <CalendarDays size={18} /> : item.type === "Member" ? <Users size={18} /> : ["Post", "Comment"].includes(item.type) ? <MessageSquare size={18} /> : <BookOpen size={18} />}</span><span><small>{item.type}</small><strong>{item.title}</strong><em>{item.detail}</em></span><ChevronRight size={17} /></button>)}
      {results.length === 0 && state !== "loading" && <div className="empty-state"><Search size={24} /><h3>{normalized ? "No matches" : "Ready to search"}</h3><p>Try a lesson topic, discussion, member name, event or property.</p></div>}
    </div>
  </section>;
}
