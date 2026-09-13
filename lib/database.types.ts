export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      questions: {
        Row: {
          answer: string | null;
          comments_count: number;
          created_at: string;
          detail: string;
          dislikes: number;
          display_name: string | null;
          id: number;
          private_reply: string | null;
          question: string;
          responder_label: string | null;
          status: Database['public']['Enums']['question_status'];
          thread_key: string | null;
          updated_at: string;
          upvotes: number;
          visibility: Database['public']['Enums']['question_visibility'];
        };
        Insert: {
          answer?: string | null;
          comments_count?: number;
          created_at?: string;
          detail?: string;
          dislikes?: number;
          display_name?: string | null;
          id?: never;
          private_reply?: string | null;
          question: string;
          responder_label?: string | null;
          status?: Database['public']['Enums']['question_status'];
          thread_key?: string | null;
          updated_at?: string;
          upvotes?: number;
          visibility?: Database['public']['Enums']['question_visibility'];
        };
        Update: {
          answer?: string | null;
          comments_count?: number;
          created_at?: string;
          detail?: string;
          dislikes?: number;
          display_name?: string | null;
          id?: never;
          private_reply?: string | null;
          question?: string;
          responder_label?: string | null;
          status?: Database['public']['Enums']['question_status'];
          thread_key?: string | null;
          updated_at?: string;
          upvotes?: number;
          visibility?: Database['public']['Enums']['question_visibility'];
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      vote_question: {
        Args: { p_direction: string; p_question_id: number };
        Returns: { dislikes: number; upvotes: number }[];
      };
    };
    Enums: {
      question_status:
        | 'Under review'
        | 'Needs clarification'
        | 'Assigned'
        | 'Answered'
        | 'Closed';
      question_visibility: 'anonymous' | 'named';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type QuestionRow = Database['public']['Tables']['questions']['Row'];
export type QuestionInsert = Database['public']['Tables']['questions']['Insert'];
