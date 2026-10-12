import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { SiteFooter, SiteHeader } from "./components/site-chrome";
import { createClient } from "../lib/supabase/server";

export const metadata: Metadata = {
  title: "The Claimant — The Crown Is Unsettled",
  description:
    "King Robert is dead. The succession is vulnerable, the great houses are watching, and no war has yet begun. Enter a political RPG set in Westeros.",
};

const regions = [
  { name: "The North", house: "House Stark", seat: "Winterfell", words: "Winter Is Coming", note: "Vast, distant, and bound to Ned Stark's place at court." },
  { name: "The Vale", house: "House Arryn", seat: "The Eyrie", words: "As High as Honor", note: "A guarded mountain realm under Lysa Arryn's regency." },
  { name: "The Riverlands", house: "House Tully", seat: "Riverrun", words: "Family, Duty, Honor", note: "Fertile, exposed, and divided among many lords." },
  { name: "The Iron Islands", house: "House Greyjoy", seat: "Pyke", words: "We Do Not Sow", note: "A defeated fleet, a resentful lord, and Theon at Winterfell." },
  { name: "The Westerlands", house: "House Lannister", seat: "Casterly Rock", words: "Hear Me Roar", note: "Gold and influence—with much of the family close to the throne." },
  { name: "The Reach", house: "House Tyrell", seat: "Highgarden", words: "Growing Strong", note: "The realm's food, ships, and a powerful undecided alliance." },
  { name: "The Stormlands", house: "House Baratheon", seat: "Storm's End", words: "Ours Is the Fury", note: "A family divided between two surviving brothers." },
  { name: "The Crownlands", house: "The Crown", seat: "King's Landing", words: "Ruled from the Iron Throne", note: "The capital, its gates, its watch, and the royal household." },
  { name: "Dorne", house: "House Martell", seat: "Sunspear", words: "Unbowed, Unbent, Unbroken", note: "A distinct principality with long memories and no open revolt." },
];

const pressures = [
  {
    number: "01",
    title: "A crown without consensus",
    text: "Joffrey is treated by the court as Robert's heir. Stannis is the elder surviving brother. A challenge to the children's legitimacy could reorder the succession—but it has not yet been made in public.",
  },
  {
    number: "02",
    title: "The capital is not the realm",
    text: "The Crown commands King's Landing most directly. Beyond it, lords control their own roads, revenues, fortresses, and men. A royal order can be delayed, resisted, or refused.",
  },
  {
    number: "03",
    title: "Every truth has a route",
    text: "Ravens, couriers, ships, and rumor carry news at human speed. A secret is not common knowledge simply because it is true—and distance gives every decision a cost.",
  },
];

async function TodosSection() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: todos, error: todosError } = await supabase
    .from("todos")
    .select("id, name")
    .order("id", { ascending: true });

  if (todosError) {
    console.error("Unable to load todos from Supabase:", todosError);
  }

  return (
    <section className="opening-section" aria-labelledby="todos-heading">
      <div className="section-index">
        <span>03</span>
        <span className="index-rule" />
        THE REALM&apos;S RECORDS
      </div>
      <div className="opening-heading">
        <h2 id="todos-heading">A ledger of<br /><em>open matters.</em></h2>
        <p>Records currently stored in the Supabase todos table.</p>
      </div>
      {todosError ? (
        <p role="alert">
          The records could not be loaded. Check that the Supabase todos
          table exists and allows public reads.
        </p>
      ) : todos?.length ? (
        <div className="pressure-grid">
          {todos.map((todo) => (
            <article className="pressure-card" key={todo.id}>
              <div className="pressure-meta">
                <span>{todo.id}</span>
                <span>OPEN MATTER</span>
              </div>
              <h3>{todo.name}</h3>
            </article>
          ))}
        </div>
      ) : (
        <p>No records have been added yet.</p>
      )}
    </section>
  );
}

export default function Home() {
  return (
    <main>
      <SiteHeader current="home" />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span />IN THE AFTERMATH OF THE KING&apos;S DEATH</p>
          <h1>
            The king is dead.
            <br />
            <em>The realm has</em>
            <br />
            <em>not chosen a future.</em>
          </h1>
          <p className="hero-deck">
            Robert Baratheon is gone. The court has a presumed heir; the great
            houses have their own interests; and the question of succession
            has not yet become open war. For now, every power is watching.
          </p>
          <div className="hero-actions">
            <a className="button-primary" href="#opening">
              Read the opening state <span aria-hidden="true">↓</span>
            </a>
            <Link className="quiet-link" href="/about">
              Discover the game <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <p className="hero-footnote">
            <span className="footnote-rule" />
            WESTEROS · IMMEDIATELY AFTER ROBERT I BARATHEON&apos;S DEATH
          </p>
        </div>

        <aside className="record-card" aria-label="Royal succession record at the opening">
          <div className="record-topline">
            <span>THE SMALL COUNCIL&apos;S RECORD</span>
            <span>OPENING STATE</span>
          </div>
          <div className="record-inner">
            <div className="record-emblem" aria-hidden="true">
              <span className="emblem-ring" />
              <span className="emblem-sun">✳</span>
              <span className="emblem-caption">THE IRON THRONE</span>
            </div>
            <p className="record-kicker">THE SUCCESSION IS UNSETTLED</p>
            <h2>Power passes<br />through people.</h2>
            <div className="record-rule" />
            <div className="record-fact">
              <span>THE KING</span>
              <strong>Robert I Baratheon · deceased</strong>
            </div>
            <div className="record-fact">
              <span>THE COURT&apos;S HEIR</span>
              <strong>Joffrey Baratheon</strong>
            </div>
            <div className="record-fact">
              <span>THE HAND</span>
              <strong>Eddard Stark</strong>
            </div>
            <div className="record-fact">
              <span>THE ELDER SURVIVING BROTHER</span>
              <strong>Stannis Baratheon · Dragonstone</strong>
            </div>
            <div className="record-seals">
              <span className="record-status-mark" aria-hidden="true">!</span>
              <p>
                <strong>No succession war has begun.</strong>
                <span>Ned has not publicly challenged the royal claim.</span>
              </p>
            </div>
            <div className="record-stamp" aria-hidden="true">IN DISPUTE</div>
          </div>
          <div className="record-bottomline">
            <span>THE CROWNLANDS</span>
            <span>A MOMENT, NOT A PROPHECY</span>
          </div>
        </aside>
      </section>

      <section className="opening-section" id="opening">
        <div className="section-index">
          <span>01</span>
          <span className="index-rule" />
          THE OPENING POSITION
        </div>
        <div className="opening-heading">
          <h2>One throne.<br /><em>No settled answer.</em></h2>
          <p>
            This is the narrow moment before the crisis breaks open. The facts
            below establish the board—not the loyalties, private knowledge, or
            choices of every person upon it.
          </p>
        </div>
        <div className="pressure-grid">
          {pressures.map((pressure) => (
            <article className="pressure-card" key={pressure.number}>
              <div className="pressure-meta">
                <span>{pressure.number}</span>
                <span>THE REALM IN TENSION</span>
              </div>
              <h3>{pressure.title}</h3>
              <p>{pressure.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="world-note">
        <div className="world-note-mark" aria-hidden="true">“</div>
        <div>
          <p className="eyebrow"><span />THE RULE THAT CHANGES EVERYTHING</p>
          <h2>A fact is not a rumour.<br /><em>And knowing is not the same as proving.</em></h2>
        </div>
        <p className="world-note-copy">
          Jon Arryn is dead. Eddard Stark is investigating. The truth behind
          the royal children is known only to a limited circle. Information
          belongs to the people who have actually learned it—and may tell it.
        </p>
      </section>

      <section className="regions-section">
        <div className="section-index">
          <span>02</span>
          <span className="index-rule" />
          THE NINE REGIONS OF WESTEROS
        </div>
        <div className="regions-heading">
          <h2>Seven Kingdoms<br /><em>by tradition. Nine regions in play.</em></h2>
          <p>
            The map is not a promise of obedience. Every house has its own
            interests, rivalries, resources, and reasons to wait.
          </p>
        </div>
        <div className="region-grid">
          {regions.map((region, index) => (
            <article className="region-card" key={region.name}>
              <div className="region-card-top">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span>{region.seat}</span>
              </div>
              <h3>{region.name}</h3>
              <p className="region-house">{region.house}</p>
              <p className="region-note">{region.note}</p>
              <p className="region-words">“{region.words}”</p>
            </article>
          ))}
        </div>
      </section>

      <Suspense
        fallback={
          <section className="opening-section" aria-busy="true">
            <div className="section-index">
              <span>03</span>
              <span className="index-rule" />
              THE REALM&apos;S RECORDS
            </div>
            <div className="opening-heading">
              <h2>A ledger of<br /><em>open matters.</em></h2>
              <p>Loading records from Supabase…</p>
            </div>
          </section>
        }
      >
        <TodosSection />
      </Suspense>

      <section className="closing-cta">
        <p className="eyebrow"><span />BEFORE ANYONE TAKES THE THRONE</p>
        <div className="closing-cta-row">
          <h2>Learn what moves<br /><em>the realm—and what it costs.</em></h2>
          <Link className="button-outline" href="/about">
            About The Claimant <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
