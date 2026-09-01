"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useEffect, useState } from "react";

const scenes = [
  {
    src: "/imagery/river-clearing.png",
    name: "Riverside clearing",
    meta: "Surface disturbance"
  },
  {
    src: "/imagery/urban-foundation.png",
    name: "Urban foundation",
    meta: "New construction"
  },
  {
    src: "/imagery/canal-roadwork.png",
    name: "Canal roadwork",
    meta: "Infrastructure change"
  }
];

export function RotatingImagery({ variant = "landing" }: { variant?: "landing" | "auth" }) {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduceMotion || paused) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % scenes.length), 5200);
    return () => window.clearInterval(timer);
  }, [reduceMotion, paused]);

  const scene = scenes[active];

  return (
    <div
      className={`rotating-imagery rotating-imagery-${variant}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Illustrative monitored locations"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="rotating-frame"
          key={scene.src}
          initial={reduceMotion ? false : { opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: .985 }}
          transition={{ duration: .65, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image src={scene.src} alt="" fill priority={active === 0} sizes={variant === "auth" ? "(max-width: 900px) 0px, 45vw" : "(max-width: 900px) 100vw, 50vw"} />
        </motion.div>
      </AnimatePresence>
      <div className="imagery-shade" />
      <motion.div
        className="imagery-caption"
        key={`${scene.name}-caption`}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: .16, duration: .35 }}
        aria-live="polite"
      >
        <span>0{active + 1}</span>
        <p><b>{scene.name}</b><small>{scene.meta}</small></p>
      </motion.div>
      <div className="imagery-controls" aria-label="Choose imagery">
        {scenes.map((item, index) => (
          <button
            type="button"
            key={item.src}
            className={index === active ? "active" : ""}
            aria-label={`Show ${item.name}`}
            aria-current={index === active ? "true" : undefined}
            onClick={() => setActive(index)}
          ><span /></button>
        ))}
      </div>
      <span className="imagery-disclaimer">Illustrative aerial imagery</span>
    </div>
  );
}
