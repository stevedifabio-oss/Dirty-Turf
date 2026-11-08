import { BookOpen } from "lucide-react";

const courses = [
  { name: "Cleaning Pavers & Travertine", price: "$195.95" },
  { name: "Tile & Grout Cleaning", price: null },
  { name: "Turf Tech Cleaning Only", price: "$195.95" },
  { name: "Cleaning Putting Greens", price: "$49.95" },
  { name: "Specialty Turf Cleaning", price: "$49.95", description: "Remove stains, gum, and spots left by pet waste." },
];

export function CourseAddOns() {
  return (
    <section aria-labelledby="courses-heading">
      <div className="upgrades-heading">
        <h3 id="courses-heading">One-time course add-ons</h3>
        <p>Individual courses are purchased separately from monthly subscriptions.</p>
      </div>
      <div className="upgrade-cards upgrade-course-cards">
        {courses.map(({ name, price, description }) => (
          <article key={name}>
            <span className="upgrade-icon" aria-hidden="true"><BookOpen size={21} /></span>
            <h4>{name}</h4>
            {description && <p>{description}</p>}
            <strong className="upgrade-price">
              {price ? <>{price}<small> once</small></> : <small>Price to be announced</small>}
            </strong>
            <span className="upgrade-status">Coming soon</span>
          </article>
        ))}
      </div>
    </section>
  );
}
