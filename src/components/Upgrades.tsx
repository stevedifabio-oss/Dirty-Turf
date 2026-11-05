import { Capacitor } from "@capacitor/core";
import { BookOpen, CreditCard, Ruler, Users } from "lucide-react";
import "./Upgrades.css";
import { NativeMemberships } from "./NativeMemberships";
import type { AccessState } from "../lib/academyAccess";

const subscriptions = [
  { name: "Community", price: "$19.99", Icon: Users, description: "Connect with turf cleaning operators, share advice and join community conversations." },
  { name: "Turf Scanner", price: "$24.95", Icon: Ruler, description: "Measure artificial turf areas, calculate job pricing and determine the amount of infill needed based on square footage." },
  { name: "Turf Cleaning Academy", price: "$24.95", Icon: BookOpen, description: "Learn professional turf cleaning and how to build a successful business, from techniques, equipment and vehicle setups to pricing, marketing and sales. Includes the existing Academy course." },
];
const courses = [
  { name: "Cleaning Pavers & Travertine", price: "$195.95" },
  { name: "Turf Tech Cleaning Only", price: "$195.95" },
  { name: "Cleaning Putting Greens", price: "$49.95" },
  { name: "Specialty Turf Cleaning", price: "$49.95", description: "Stains, gum and other turf cleaning challenges." },
];

export function Upgrades({ access = { status: "loading" } }: { access?: AccessState }) {
  if (Capacitor.isNativePlatform()) return <NativeMemberships access={access} />;
  return <div className="view-content upgrades-page">
    <section className="upgrades-intro"><p className="kicker">Your account. Your choice.</p><h2>Memberships & Upgrades</h2><p>Choose one, any two, or all three subscriptions. Add individual courses separately.</p><a className="secondary-button" href="/billing"><CreditCard size={17} /> Manage current billing</a></section>
    <div className="upgrades-availability" role="status"><strong>New enrollment is being prepared.</strong><p>These are the planned options and prices. New purchases and the Turf Scanner trial are not available here yet. Your existing paid, imported and complimentary access stays in place.</p></div>
    <section aria-labelledby="subscriptions-heading"><div className="upgrades-heading"><h3 id="subscriptions-heading">Monthly subscriptions</h3><p>Each subscription is separate.</p></div><div className="upgrade-cards">
      {subscriptions.map(({ name, price, Icon, description }) => <article key={name}><span className="upgrade-icon"><Icon size={23} /></span><h4>{name}</h4><p>{description}</p><strong className="upgrade-price">{price}<small> / month</small></strong>{name === "Turf Scanner" && <p className="upgrade-trial">Planned 7-day free trial. Access ends unless you choose to subscribe; no automatic charge.</p>}<span className="upgrade-status">Coming soon</span></article>)}
    </div></section>
    <section aria-labelledby="courses-heading"><div className="upgrades-heading"><h3 id="courses-heading">One-time course purchases</h3><p>Separate from your monthly subscriptions. No recurring charge.</p></div><div className="upgrade-cards upgrade-course-cards">
      {courses.map(({ name, price, description }) => <article key={name}><span className="upgrade-icon"><BookOpen size={21} /></span><h4>{name}</h4>{description && <p>{description}</p>}<strong className="upgrade-price">{price}<small> once</small></strong><span className="upgrade-status">Coming soon</span></article>)}
    </div></section>
  </div>;
}
