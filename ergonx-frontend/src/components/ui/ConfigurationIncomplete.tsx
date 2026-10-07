import Alert from "@/components/ui/Alert";

interface ConfigurationIncompleteProps {
  blockers: string[];
}

export default function ConfigurationIncomplete({ blockers }: ConfigurationIncompleteProps) {
  if (blockers.length === 0) return null;
  return (
    <Alert tone="warning" title="Configuration incomplete">
      <p>Complete the following required items before the institution can be marked Ready.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
      </ul>
    </Alert>
  );
}
