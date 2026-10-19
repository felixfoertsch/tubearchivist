import type { ReactNode } from 'react';
import useIsAdmin from '../../functions/useIsAdmin';
import { Card } from '../ui/card';

export default function SettingsFrame({
  title,
  children,
  admin = true,
}: {
  title: string;
  children: ReactNode;
  admin?: boolean;
}) {
  const isAdmin = useIsAdmin();
  return (
    <section className="mx-auto w-full max-w-6xl space-y-4 p-3 sm:p-5">
      <title>{`TA | ${title}`}</title>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {admin && !isAdmin ? (
        <Card className="p-4">
          <p role="alert">Administrator access required.</p>
        </Card>
      ) : (
        children
      )}
    </section>
  );
}
