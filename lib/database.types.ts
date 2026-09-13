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
      question_thoughts: {
        Row: {
          body: string;
          created_at: string;
          id: number;
          question_id: number;
          status: Database['public']['Enums']['question_thought_status'];
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: never;
          question_id: number;
          status?: Database['public']['Enums']['question_thought_status'];
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: never;
          question_id?: number;
          status?: Database['public']['Enums']['question_thought_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'question_thoughts_question_id_fkey';
            columns: ['question_id'];
            isOneToOne: false;
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };
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
      is_everstage_user: { Args: never; Returns: boolean };
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
      question_thought_status: 'published' | 'hidden';
      question_visibility: 'anonymous' | 'named';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type QuestionRow = Database['public']['Tables']['questions']['Row'];
export type QuestionInsert =
  Database['public']['Tables']['questions']['Insert'];
export type QuestionThoughtRow =
  Database['public']['Tables']['question_thoughts']['Row'];
export type QuestionThoughtInsert =
  Database['public']['Tables']['question_thoughts']['Insert'];
