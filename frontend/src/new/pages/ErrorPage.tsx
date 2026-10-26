import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';
import NewRoutes from '../routes';
import { Button } from '../ui/button';

export default function ErrorPage() {
  const error = useRouteError();
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <title>TA | Unable to load</title>
      <h1 className="text-2xl font-semibold">
        {forbidden ? 'Access denied' : 'Unable to load TubeArchivist'}
      </h1>
      <p role="alert">
        {forbidden
          ? 'Your account does not have permission to view this page.'
          : 'Session, account settings or page data could not be loaded. Check your connection and retry.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" onClick={() => window.location.reload()}>
          Retry
        </Button>
        <Button variant="outline" asChild>
          <Link to={NewRoutes.Home}>Home</Link>
        </Button>
      </div>
    </main>
  );
}
