import DOMPurify from 'dompurify';

function searchHighlight(value: string): string {
  return DOMPurify.sanitize(value, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
}

export default function SearchHighlight({ value }: { value: string }) {
  return (
    <p
      className="whitespace-pre-wrap text-sm"
      dangerouslySetInnerHTML={{
        __html: searchHighlight(
          value.replace(/<span\b[^>]*>/gi, '<mark>').replace(/<\/span\s*>/gi, '</mark>'),
        ),
      }}
    />
  );
}
