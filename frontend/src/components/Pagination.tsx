export type PaginationType = {
  page_size?: number;
  page_from?: number;
  prev_pages?: false | number[];
  current_page: number;
  max_hits?: boolean;
  params?: string;
  last_page?: number;
  next_pages?: [];
  total_hits?: number;
};
