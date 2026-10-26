type Feature = { emoji: string; title: string; text: string };

/** Cards for the parts of a dashboard that come in the next frontend steps. */
export function ComingSoon({ features }: { features: Feature[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((feature) => (
        <li
          key={feature.title}
          className="flex flex-col gap-2 rounded-3xl bg-white p-5 shadow-sm ring-2 ring-brand-100"
        >
          <span className="text-3xl" aria-hidden="true">
            {feature.emoji}
          </span>
          <h3 className="text-lg font-bold">{feature.title}</h3>
          <p className="text-ink-soft">{feature.text}</p>
          <span className="mt-auto w-fit rounded-full bg-sun-200 px-3 py-0.5 text-sm font-bold">
            Coming soon
          </span>
        </li>
      ))}
    </ul>
  );
}
