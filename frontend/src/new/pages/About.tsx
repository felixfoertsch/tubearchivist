import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export default function About() {
  const links = [
    ['Roadmap', 'https://github.com/tubearchivist/tubearchivist#roadmap'],
    ['User guide', 'https://docs.tubearchivist.com'],
    ['Report an issue', 'https://github.com/tubearchivist/tubearchivist/issues'],
    ['Discord', 'https://www.tubearchivist.com/discord'],
    ['Contributing', 'https://github.com/tubearchivist/tubearchivist/blob/master/CONTRIBUTING.md'],
    ['Donate', 'https://github.com/tubearchivist/tubearchivist#donate'],
  ];
  return (
    <>
      <title>TA | About</title>
      <Card>
        <CardHeader>
          <CardTitle>About TubeArchivist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Your Self Hosted YouTube Media Server. This project is in active development.
            Contributions and support are welcome.
          </p>
          <nav aria-label="Project resources" className="flex flex-wrap gap-4">
            {links.map(([label, href]) => (
              <a className="underline" key={href} href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            ))}
          </nav>
        </CardContent>
      </Card>
    </>
  );
}
