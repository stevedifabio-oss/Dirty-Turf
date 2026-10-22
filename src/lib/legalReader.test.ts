import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import termsSource from "../../public/terms.html?raw";
import privacySource from "../../public/privacy.html?raw";
import { legalReaderNodes, type LegalReaderNode } from "./legalReader";

const parser = () => new XmlDomParser() as unknown as DOMParser;
const text = (nodes: LegalReaderNode[]): string => nodes.map(node => typeof node === "string" ? node : text(node.children)).join("");
const elements = (nodes: LegalReaderNode[]): Exclude<LegalReaderNode, string>[] => nodes.flatMap(node => typeof node === "string" ? [] : [node, ...elements(node.children)]);
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

describe("accessible inert legal reader", () => {
  it.each([["terms", termsSource], ["privacy", privacySource]])("preserves every word in the actual %s main document and its headings and lists", (_name, source) => {
    const original = parser().parseFromString(source, "text/html").getElementsByTagName("main")[0];
    const nodes = legalReaderNodes(source, parser());
    expect(normalize(text(nodes))).toBe(normalize(original.textContent ?? ""));
    const read = elements(nodes);
    expect(read.some(node => node.tag === "h3")).toBe(true);
    expect(read.filter(node => node.tag === "h4")).toHaveLength(original.getElementsByTagName("h2").length);
    expect(read.filter(node => node.tag === "li")).toHaveLength(original.getElementsByTagName("li").length);
    expect(read.some(node => node.tag === "section")).toBe(true);
    expect(JSON.stringify(nodes)).not.toMatch(/href|onclick|src|sandbox/);
  });
  it("keeps links as plain text and never carries markup attributes or active resource nodes into React", () => {
    const nodes = legalReaderNodes(`<main><h1 onclick="run()">Rules</h1><p class="lede untrusted" style="color:red" id="outside"><a href="javascript:run()">Support &amp; privacy</a><strong onmouseover="run()">Read this</strong></p><script>steal()</script><style>body{display:none}</style><iframe src="https://example.invalid"/><img src="https://example.invalid/private"/><svg><title>Discarded SVG</title></svg><object>Discarded object</object><p>&lt;script&gt; stays literal</p></main>`, parser());
    expect(text(nodes)).toBe("RulesSupport & privacyRead this<script> stays literal");
    expect(elements(nodes).map(node => node.tag)).toEqual(["h3", "p", "strong", "p"]);
    expect(elements(nodes)[1].className).toBe("lede");
    expect(JSON.stringify(nodes)).not.toMatch(/run\(\)|steal|example.invalid|onclick|style|outside|untrusted|Discarded/);
  });
  it("requires exactly one document main region", () => {
    expect(() => legalReaderNodes("<div>No document</div>", parser())).toThrow("unavailable");
    expect(() => legalReaderNodes("<html><body><main>One</main><main>Two</main></body></html>", parser())).toThrow("unavailable");
  });
});
