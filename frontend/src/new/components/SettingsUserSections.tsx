import type { ReactNode } from 'react';
import { Card } from '../ui/card';

export function SettingsUserSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </Card>
  );
}
