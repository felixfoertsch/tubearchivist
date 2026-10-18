import { Link } from 'react-router-dom';
import NewRoutes from '../routes';
import { Button } from '../ui/button';

export default function NotFound() {
  return (
    <section className="space-y-4" aria-labelledby="not-found-title">
      <title>TA | Not found</title>
      <h1 id="not-found-title" className="text-2xl font-semibold">
        Page not found
      </h1>
      <p>This address does not match a TubeArchivist page.</p>
      <Button variant="outline" asChild>
        <Link to={NewRoutes.Home}>Home</Link>
      </Button>
    </section>
  );
}
