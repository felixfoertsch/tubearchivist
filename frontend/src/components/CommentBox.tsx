export type CommentsType = {
  comment_id: string;
  comment_text: string;
  comment_timestamp: number;
  comment_time_text: string;
  comment_likecount: number;
  comment_is_favorited: boolean;
  comment_author: string;
  comment_author_id: string;
  comment_author_thumbnail: string;
  comment_author_is_uploader: boolean;
  comment_parent: string;
  comment_replies: CommentsType[];
};
