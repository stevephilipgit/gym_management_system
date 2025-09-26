import { memo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../utils/apiClient.js";
import NavbarMemberCheck from "../components/NavbarMemberCheck";

const FeatureCard = memo(({ title, desc, className = "" }) => (
  <article className={`bento-card ${className}`}>
    <span className="eyebrow">Performance</span>
    <h3 className="panel-title mt-3">{title}</h3>
    <p className="panel-subtitle mt-3">{desc}</p>
  </article>
));

FeatureCard.displayName = "FeatureCard";

const PackageCard = memo(({ pkg, navigate }) => (
  <article className="bento-card bento-span-3">
    <div className="section-stack">
      <div>
        <span className="eyebrow">Membership</span>
        <h3 className="panel-title mt-3">{pkg.name}</h3>
        <p className="muted-copy mt-2">
          {pkg.months} Month{pkg.months > 1 ? "s" : ""} access
        </p>
      </div>

      <div className="section-stack" style={{ gap: "12px" }}>
        <div className="chip">Weight Gain: Rs. {pkg.priceWeightGain}</div>
        <div className="chip">Weight Loss: Rs. {pkg.priceWeightLoss}</div>
        <div className="chip">Transformation: Rs. {pkg.priceTransformation}</div>
      </div>

      <button onClick={() => navigate("/login")} className="btn-primary">
        Enroll Now
      </button>
    </div>
  </article>
));

PackageCard.displayName = "PackageCard";

const TransformationCard = memo(({ img, review, idx }) => (
  <article className="bento-card bento-span-4">
    <div className="media-card">
      <img src={img} alt={`Transformation ${idx + 1}`} loading="lazy" style={{ height: "280px" }} />
    </div>
    <p className="panel-subtitle mt-4">"{review}"</p>
  </article>
));

TransformationCard.displayName = "TransformationCard";

export default function Home() {
  const navigate = useNavigate();
  const [packages, setPackages] = useState([]);

  useEffect(() => {
    const loadPackages = async () => {
      try {
        const res = await apiClient.get("/packages");
        const packageList = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data)
          ? res.data
          : [];
        setPackages(packageList);
      } catch (err) {
        console.error("Package Load Error:", err);
        setPackages([]);
      }
    };

    loadPackages();
  }, []);

  return (
    <div className="page-shell">
      <nav className="glass-bar">
        <div className="page-frame flex items-center justify-between gap-4 py-4">
          <div>
            <p className="eyebrow">Fitness System</p>
            <div className="text-2xl font-extrabold tracking-[0.18em] dark-text">GIRI GYM</div>
          </div>

          <div className="flex items-center gap-3">
            <NavbarMemberCheck />
            <button onClick={() => navigate("/login")} className="nav-link nav-link-active" aria-label="Login to admin dashboard">
              Admin Login
            </button>
          </div>
        </div>
      </nav>

      <div className="page-frame section-stack py-8">
        <section className="hero-grid">
          <div className="hero-panel">
            <div className="hero-image h-full">
              <img
                src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1350&q=80"
                alt="Giri Gym training floor"
                style={{ height: "100%", minHeight: "640px" }}
              />
            </div>

            <div className="absolute inset-0 z-10 flex items-end p-6 sm:p-8">
              <div className="max-w-2xl section-stack">
                <span className="eyebrow">Strength. Discipline. Precision.</span>
                <h1 className="text-5xl font-extrabold leading-tight sm:text-6xl">
                  Train inside a sharper system built for real progress.
                </h1>
                <p className="max-w-xl text-base sm:text-lg">
                  High-focus coaching, structured memberships, and a gym floor designed to keep momentum visible every week.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => navigate("/login")} className="btn-primary" aria-label="Join gym now">
                    Join Now
                  </button>
                  <button
                    onClick={() => document.getElementById("packages-section")?.scrollIntoView({ behavior: "smooth" })}
                    className="btn-secondary"
                  >
                    View Plans
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="section-stack">
            <FeatureCard
              title="Structured Coaching"
              desc="Every member path is built around repeatable routines, expert supervision, and measurable training blocks."
            />
            <FeatureCard
              title="Modern Equipment Floor"
              desc="A machine mix that supports weight gain, fat loss, and transformation programs without clutter."
            />
            <FeatureCard
              title="Membership Visibility"
              desc="Quick validity checks, transparent package options, and an admin system that keeps operations clean."
            />
          </div>
        </section>

        <section className="section-shell">
          <div className="section-heading mb-6">
            <span className="eyebrow">Why Us</span>
            <h2 className="text-3xl sm:text-4xl">A modular gym experience, not a generic floor.</h2>
          </div>

          <div className="bento-grid">
            <FeatureCard
              className="bento-span-5"
              title="Certified Trainers"
              desc="Clear instruction, progress monitoring, and sharper exercise execution for all levels."
            />
            <FeatureCard
              className="bento-span-7"
              title="Personalized Training and Diet Support"
              desc="Plans are matched to each member's objective so the gym experience stays focused and sustainable."
            />
          </div>
        </section>

        <section id="packages-section" className="section-shell">
          <div className="section-heading mb-6">
            <span className="eyebrow">Plans</span>
            <h2 className="text-3xl sm:text-4xl">Membership packages built for practical commitment.</h2>
          </div>

          <div className="bento-grid">
            {packages.length === 0 && (
              <div className="bento-card bento-span-12">
                <p className="panel-subtitle">Loading packages...</p>
              </div>
            )}

            {packages.map((pkg) => (
              <PackageCard key={pkg._id} pkg={pkg} navigate={navigate} />
            ))}
          </div>
        </section>

        <section className="section-shell">
          <div className="section-heading mb-6">
            <span className="eyebrow">Results</span>
            <h2 className="text-3xl sm:text-4xl">Transformations from members who stayed consistent.</h2>
          </div>

          <div className="bento-grid">
            <TransformationCard
              idx={0}
              img="https://images.unsplash.com/photo-1599058917212-d750089bc07a?auto=format&fit=crop&w=600&q=60"
              review="Lost 12kg in 3 months. The trainers kept the process disciplined and realistic."
            />
            <TransformationCard
              idx={1}
              img="https://images.unsplash.com/photo-1550345332-09e3ac987658?auto=format&fit=crop&w=600&q=60"
              review="The atmosphere feels focused, clean, and serious about progress."
            />
            <TransformationCard
              idx={2}
              img="https://images.unsplash.com/photo-1595929287352-74df0162c126?auto=format&fit=crop&w=600&q=60"
              review="My body changed because the plan stayed structured from day one."
            />
          </div>
        </section>
      </div>

      <footer className="section-shell">
        <div className="page-frame bento-grid">
          <div className="bento-card bento-span-4">
            <span className="eyebrow">Quick Links</span>
            <div className="section-stack mt-4" style={{ gap: "12px" }}>
              <button onClick={() => navigate("/")} className="btn-ghost justify-start">
                Home
              </button>
              <button onClick={() => navigate("/login")} className="btn-ghost justify-start">
                Login
              </button>
            </div>
          </div>

          <div className="bento-card bento-span-4">
            <span className="eyebrow">Contact</span>
            <div className="section-stack mt-4" style={{ gap: "8px" }}>
              <p>Phone: +91 98765 43210</p>
              <p>Email: girigym@gmail.com</p>
            </div>
          </div>

          <div className="bento-card bento-span-4">
            <span className="eyebrow">Location</span>
            <div className="section-stack mt-4" style={{ gap: "8px" }}>
              <p>Giri Gym, Chennai, Tamil Nadu</p>
              <p className="muted-copy">Map integration can slot into this module later.</p>
            </div>
          </div>
        </div>

        <div className="page-frame pt-6">
          <p className="muted-copy">Copyright 2025 Giri Gym. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
