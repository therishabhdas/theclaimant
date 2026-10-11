import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../components/site-chrome";

export const metadata: Metadata = {
  title: "About The Claimant — A Political RPG in Westeros",
  description:
    "A grounded political RPG set in Westeros at the moment after King Robert's death: contested succession, divided loyalties, imperfect information, and consequential choices.",
};

const principles = [
  {
    number: "01",
    title: "Power needs people and supplies.",
    text: "A title cannot feed a city or march an army. Coin, roads, grain, ships, horses, fortresses, and willing allies determine what a ruler can actually do. Mustering takes time; victory can leave debts behind.",
  },
  {
    number: "02",
    title: "Information travels at human speed.",
    text: "Ravens, couriers, ships, and rumor have distance, delay, and risk. Characters act on what they have plausibly learned—not on facts available only to the player or narrator.",
  },
  {
    number: "03",
    title: "A house is not a single mind.",
    text: "Kin, bannermen, cadet branches, regents, heirs, and rival claimants have overlapping loyalties. A house's words and sigil are history, not a script for how every member must behave.",
  },
  {
    number: "04",
    title: "Legitimacy is not obedience.",
    text: "The Crown is strongest near King's Landing. Beyond the capital, great lords control their own men, justice, roads, and revenues. A lawful claim can be resisted; an order can be delayed, reinterpreted, or refused.",
  },
  {
    number: "05",
    title: "The starting state stays open.",
    text: "No later campaign, betrayal, arrest, death, or victory is treated as inevitable. The opening is a deliberate freeze-frame; what follows comes from character decisions and their consequences.",
  },
];

const powerCenters = [
  {
    label: "THE CROWN",
    title: "A capital full of levers",
    text: "The Red Keep, the Small Council, the Kingsguard, the City Watch, the royal household, and the gates of King's Landing each matter. They are institutions and networks—not a single, perfectly loyal machine.",
  },
  {
    label: "THE CLAIMANTS",
    title: "Three different positions",
    text: "Joffrey is treated as heir by the court. Stannis is Robert's elder surviving brother, based at Dragonstone. Renly is the younger brother, in King's Landing, with his own court relationships and ambitions.",
  },
  {
    label: "THE REGIONS",
    title: "Nine powers, no automatic bloc",
    text: "The great houses weigh custom, kinship, marriage, rivalries, debts, geography, and expected outcomes. Even minor lords can change the balance when they control a crossing, a port, a harvest, or a vital promise.",
  },
];

export default function AboutPage() {
  return (
    <main>
      <SiteHeader current="about" />

      <section className="about-hero">
        <p className="eyebrow"><span />A POLITICAL RPG ABOUT THE COST OF RULE</p>
        <h1>
          The crown is
          <br />
          <em>not the same</em>
          <br />
          as the realm.
        </h1>
        <div className="about-hero-bottom">
          <p>
            The Claimant begins in Westeros immediately after Robert
            Baratheon&apos;s death—before Eddard Stark openly challenges the
            succession, before open civil war, and before anyone knows which
            choices will change the realm.
          </p>
          <a className="quiet-link" href="#how-it-works">
            How the world works <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <section className="about-inciting">
        <div className="section-index">
          <span>01</span>
          <span className="index-rule" />
          THE OPENING MOMENT
        </div>
        <div className="inciting-grid">
          <div>
            <p className="inciting-date">THE KING IS DEAD · THE REALM IS WATCHING</p>
            <h2>Robert is gone.<br /><em>The succession is not settled.</em></h2>
          </div>
          <div className="inciting-copy">
            <p>
              In King&apos;s Landing, the royal court treats Joffrey as the
              king&apos;s eldest legitimate son and heir. Eddard Stark is Hand.
              Queen Cersei and the royal children are in the capital; Stannis
              Baratheon is at Dragonstone, while Renly remains at court.
            </p>
            <p>
              Jon Arryn&apos;s death has left an investigation unresolved.
              The great houses are watching, but no realm-wide declaration has
              settled the claim and no war of succession has begun. The North
              has not declared independence; the Vale has not joined a revolt;
              the Reach has not committed to a later alliance.
            </p>
            <p className="inciting-caveat">
              This is the public starting position, not an omniscient account
              of what each person knows. Later events remain possible—not
              established.
            </p>
          </div>
        </div>
      </section>

      <section className="about-world">
        <div className="section-index">
          <span>02</span>
          <span className="index-rule" />
          WHERE POWER ACTUALLY LIVES
        </div>
        <div className="about-world-heading">
          <h2>A throne held up<br /><em>by people and places.</em></h2>
          <p>
            The Iron Throne has authority. Its reach still depends on those who
            recognize its claim, carry its orders, supply its city, and enforce
            its will.
          </p>
        </div>
        <div className="world-ledgers">
          {powerCenters.map((center) => (
            <article key={center.label}>
              <span>{center.label}</span>
              <h3>{center.title}</h3>
              <p>{center.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-principles" id="how-it-works">
        <div className="principles-heading">
          <div>
            <div className="section-index">
              <span>03</span>
              <span className="index-rule" />
              THE RULES BENEATH THE STORY
            </div>
            <h2>Grounded in the<br /><em>things power cannot ignore.</em></h2>
          </div>
          <p>
            The world responds to what can be moved, known, promised, and
            remembered—not to a predetermined plot.
          </p>
        </div>
        <div className="principle-list">
          {principles.map((principle) => (
            <article className="principle-row" key={principle.number}>
              <span className="principle-number">{principle.number}</span>
              <h3>{principle.title}</h3>
              <p>{principle.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-heading">
          <div className="section-index">
            <span>04</span>
            <span className="index-rule" />
            WHAT IS KNOWN—and BY WHOM
          </div>
          <h2>A secret changes nothing<br /><em>until it reaches someone.</em></h2>
        </div>
        <div className="knowledge-grid">
          <article className="knowledge-card knowledge-public">
            <p className="knowledge-label">PUBLIC OR WIDELY KNOWN</p>
            <h3>The facts at court</h3>
            <ul>
              <li>King Robert is dead; Joffrey is publicly treated as his heir.</li>
              <li>Eddard Stark is Hand, and Jon Arryn is dead.</li>
              <li>Stannis is at Dragonstone; the brothers have separate networks.</li>
              <li>Theon Greyjoy was raised at Winterfell after the Greyjoy defeat.</li>
            </ul>
          </article>
          <article className="knowledge-card knowledge-private">
            <p className="knowledge-label">LIMITED, PRIVATE, OR UNRESOLVED</p>
            <h3>The facts that must be learned</h3>
            <ul>
              <li>The truth of the royal children&apos;s parentage is not common knowledge.</li>
              <li>Ned&apos;s exact suspicions and evidence are not public.</li>
              <li>Varys&apos;s network and Littlefinger&apos;s private designs are not self-evident.</li>
              <li>Each great house&apos;s intentions remain its own decision.</li>
            </ul>
          </article>
        </div>
        <p className="knowledge-note">
          Knowledge is tracked by character: what they know, how and when they
          learned it, and whom they told. A player&apos;s knowledge is not
          automatically a character&apos;s knowledge.
        </p>
      </section>

      <section className="about-player">
        <div className="player-heading">
          <div className="section-index">
            <span>05</span>
            <span className="index-rule" />
            YOUR PLACE IN THE CHRONICLE
          </div>
          <h2>Choose a course.<br /><em>Live with its wake.</em></h2>
        </div>
        <div className="player-copy">
          <p>
            Take the perspective of a noble house or aspiring ruler. Seek
            recognition, preserve the peace, secure your family, build an
            alliance, or make a claim of your own. The realm offers no clean
            choice without a price.
          </p>
          <p>
            Armies need food and time. Messages can arrive too late. A marriage
            binds two families but may create new rivals. A promise can win an
            ally today and become a debt tomorrow. The chronicle follows the
            consequences—not a fixed route to the throne.
          </p>
          <Link className="button-primary" href="/#opening">
            Return to the opening state <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <section className="about-final">
        <p>THE KING IS DEAD. THE REALM IS NOT AT WAR.</p>
        <h2>What will your claim<br /><em>ask others to believe?</em></h2>
        <Link className="button-outline" href="/">
          Enter The Claimant <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <SiteFooter />
    </main>
  );
}
