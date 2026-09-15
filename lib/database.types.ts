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
          moderated_at: string | null;
          moderation_state: string;
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
          moderated_at?: string | null;
          moderation_state?: string;
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
          moderated_at?: string | null;
          moderation_state?: string;
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
      get_unask_analytics: {
        Args: { p_period?: string };
        Returns: Json;
      };
      get_unask_hr_thread: {
        Args: { p_question_id: number };
        Returns: {
          employee_reply: string | null;
          employee_reply_at: string | null;
          private_reply: string | null;
        }[];
      };
      get_unask_recovery_vault: {
        Args: { p_vault_hash: string };
        Returns: {
          ciphertext: string;
          iv: string;
          salt: string;
          vault_version: number;
        }[];
      };
      get_staff_profile: {
        Args: Record<PropertyKey, never>;
        Returns: {
          responder_label: string | null;
          staff_role: string | null;
        }[];
      };
      get_unask_question_thread: {
        Args: { p_question_id: number; p_thread_hash: string };
        Returns: {
          answer: string | null;
          comments_count: number;
          created_at: string;
          detail: string;
          dislikes: number;
          display_name: string | null;
          id: number;
          private_reply: string | null;
          employee_reply: string | null;
          employee_reply_at: string | null;
          question: string;
          responder_label: string | null;
          status: Database['public']['Enums']['question_status'];
          updated_at: string;
          upvotes: number;
          visibility: Database['public']['Enums']['question_visibility'];
        }[];
      };
      is_everstage_user: { Args: never; Returns: boolean };
      list_unask_responders: {
        Args: Record<PropertyKey, never>;
        Returns: { responder_label: string | null }[];
      };
      list_my_unask_votes: {
        Args: Record<PropertyKey, never>;
        Returns: { direction: string; question_id: number }[];
      };
      get_unask_report_counts: {
        Args: Record<PropertyKey, never>;
        Returns: { open_reports: number; question_id: number }[];
      };
      moderate_unask_thought: {
        Args: { p_action: string; p_thought_id: number };
        Returns: undefined;
      };
      moderate_unask_question: {
        Args: {
          p_action: string;
          p_private_reply?: string;
          p_question_id: number;
          p_responder_label?: string;
        };
        Returns: undefined;
      };
      publish_unask_answer: {
        Args: { p_answer: string; p_question_id: number };
        Returns: undefined;
      };
      respond_to_unask_clarification: {
        Args: { p_question_id: number; p_reply: string; p_thread_hash: string };
        Returns: undefined;
      };
      save_unask_recovery_vault: {
        Args: {
          p_ciphertext: string;
          p_expected_version?: number;
          p_iv: string;
          p_salt: string;
          p_vault_hash: string;
        };
        Returns: { vault_version: number }[];
      };
      set_unask_vote: {
        Args: { p_direction: string; p_question_id: number };
        Returns: {
          dislikes: number;
          my_vote: string | null;
          upvotes: number;
        }[];
      };
      submit_unask_thought: {
        Args: { p_body: string; p_question_id: number };
        Returns: {
          body: string;
          created_at: string;
          id: number;
          question_id: number;
        }[];
      };
      submit_unask_report: {
        Args: { p_reason: string; p_target_id: number; p_target_type: string };
        Returns: undefined;
      };
      submit_unask_question: {
        Args: {
          p_detail: string;
          p_display_name: string;
          p_question: string;
          p_thread_hash: string;
          p_visibility: string;
        };
        Returns: {
          answer: string | null;
          comments_count: number;
          created_at: string;
          detail: string;
          dislikes: number;
          display_name: string | null;
          id: number;
          question: string;
          responder_label: string | null;
          status: Database['public']['Enums']['question_status'];
          updated_at: string;
          upvotes: number;
          visibility: Database['public']['Enums']['question_visibility'];
        }[];
      };
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
