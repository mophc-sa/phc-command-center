export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_interactions: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          feedback: string | null
          id: string
          interaction_date: string
          interaction_type: string
          next_action: string | null
          next_action_due: string | null
          outcome: string | null
          priority: string | null
          source_batch_id: string | null
          source_row_id: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          id?: string
          interaction_date: string
          interaction_type: string
          next_action?: string | null
          next_action_due?: string | null
          outcome?: string | null
          priority?: string | null
          source_batch_id?: string | null
          source_row_id?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          id?: string
          interaction_date?: string
          interaction_type?: string
          next_action?: string | null
          next_action_due?: string | null
          outcome?: string | null
          priority?: string | null
          source_batch_id?: string | null
          source_row_id?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_interactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_interactions_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_interactions_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          draft_content: string | null
          id: string
          occurred_at: string
          owner_id: string | null
          related_opportunity_id: string | null
          related_rfq_id: string | null
          related_tender_id: string | null
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["activity_status"]
          summary: string | null
          template_id: string | null
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["activity_type"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_content?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string | null
          related_opportunity_id?: string | null
          related_rfq_id?: string | null
          related_tender_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
          template_id?: string | null
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["activity_type"]
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          draft_content?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string | null
          related_opportunity_id?: string | null
          related_rfq_id?: string | null
          related_tender_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_related_rfq_id_fkey"
            columns: ["related_rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_related_tender_id_fkey"
            columns: ["related_tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_name: string
          completed_at: string | null
          errors: Json | null
          id: string
          loop_name: string | null
          records_created: number | null
          records_processed: number | null
          records_updated: number | null
          snapshot_version: string | null
          started_at: string
          status: Database["public"]["Enums"]["agent_run_status"]
          summary: string | null
        }
        Insert: {
          agent_name: string
          completed_at?: string | null
          errors?: Json | null
          id?: string
          loop_name?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          snapshot_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          summary?: string | null
        }
        Update: {
          agent_name?: string
          completed_at?: string | null
          errors?: Json | null
          id?: string
          loop_name?: string | null
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          snapshot_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["agent_run_status"]
          summary?: string | null
        }
        Relationships: []
      }
      ai_agent_feedback: {
        Row: {
          action: string
          created_at: string
          id: string
          note: string | null
          recommendation_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          note?: string | null
          recommendation_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          note?: string | null
          recommendation_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_feedback_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_advice_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_feedback_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_outputs: {
        Row: {
          agent_key: string
          client_request_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          output_type: string
          requested_by: string | null
          review_decision: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          structured_output: Json
          summary: string | null
          trace_id: string
          updated_at: string
        }
        Insert: {
          agent_key: string
          client_request_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          output_type: string
          requested_by?: string | null
          review_decision?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          structured_output: Json
          summary?: string | null
          trace_id: string
          updated_at?: string
        }
        Update: {
          agent_key?: string
          client_request_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          output_type?: string
          requested_by?: string | null
          review_decision?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          structured_output?: Json
          summary?: string | null
          trace_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_agent_requests: {
        Row: {
          agent_key: string
          client_request_id: string
          created_at: string
          entity_id: string
          entity_type: string
          error_code: string | null
          id: string
          output_id: string | null
          request_fingerprint: string | null
          requested_by: string | null
          status: string
          trace_id: string | null
          updated_at: string
        }
        Insert: {
          agent_key: string
          client_request_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          error_code?: string | null
          id?: string
          output_id?: string | null
          request_fingerprint?: string | null
          requested_by?: string | null
          status?: string
          trace_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_key?: string
          client_request_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_code?: string | null
          id?: string
          output_id?: string | null
          request_fingerprint?: string | null
          requested_by?: string | null
          status?: string
          trace_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_requests_output_id_fkey"
            columns: ["output_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_runs: {
        Row: {
          agent_key: string
          completed_at: string | null
          created_by: string | null
          error: string | null
          id: string
          recommendations_created: number
          records_scanned: number
          started_at: string
          status: string
          summary: string | null
        }
        Insert: {
          agent_key: string
          completed_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          recommendations_created?: number
          records_scanned?: number
          started_at?: string
          status?: string
          summary?: string | null
        }
        Update: {
          agent_key?: string
          completed_at?: string | null
          created_by?: string | null
          error?: string | null
          id?: string
          recommendations_created?: number
          records_scanned?: number
          started_at?: string
          status?: string
          summary?: string | null
        }
        Relationships: []
      }
      ai_agent_trace_events: {
        Row: {
          agent_key: string
          context_manifest: Json
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          error_message: string | null
          id: string
          input_character_count: number | null
          input_token_count: number | null
          metadata: Json
          model: string | null
          output_character_count: number | null
          output_token_count: number | null
          provider: string | null
          requested_by: string | null
          status: string
          trace_id: string
        }
        Insert: {
          agent_key: string
          context_manifest?: Json
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_character_count?: number | null
          input_token_count?: number | null
          metadata?: Json
          model?: string | null
          output_character_count?: number | null
          output_token_count?: number | null
          provider?: string | null
          requested_by?: string | null
          status: string
          trace_id: string
        }
        Update: {
          agent_key?: string
          context_manifest?: Json
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_character_count?: number | null
          input_token_count?: number | null
          metadata?: Json
          model?: string | null
          output_character_count?: number | null
          output_token_count?: number | null
          provider?: string | null
          requested_by?: string | null
          status?: string
          trace_id?: string
        }
        Relationships: []
      }
      ai_evidence_items: {
        Row: {
          created_at: string
          field: string | null
          id: string
          label: string
          recommendation_id: string
          source_ref: string | null
          source_type: string | null
          source_url: string | null
          value: string | null
          weight: number | null
        }
        Insert: {
          created_at?: string
          field?: string | null
          id?: string
          label: string
          recommendation_id: string
          source_ref?: string | null
          source_type?: string | null
          source_url?: string | null
          value?: string | null
          weight?: number | null
        }
        Update: {
          created_at?: string
          field?: string | null
          id?: string
          label?: string
          recommendation_id?: string
          source_ref?: string | null
          source_type?: string | null
          source_url?: string | null
          value?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_evidence_items_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_advice_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_evidence_items_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          agent_key: string
          confidence: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          entity_id: string | null
          entity_type: string | null
          generated_by: string
          id: string
          missing_data: string[] | null
          rationale: string | null
          recommendation: string
          required_approval_type: string | null
          run_id: string | null
          severity: string | null
          status: string
          suggested_action: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agent_key: string
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string | null
          entity_type?: string | null
          generated_by?: string
          id?: string
          missing_data?: string[] | null
          rationale?: string | null
          recommendation: string
          required_approval_type?: string | null
          run_id?: string | null
          severity?: string | null
          status?: string
          suggested_action?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agent_key?: string
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string | null
          entity_type?: string | null
          generated_by?: string
          id?: string
          missing_data?: string[] | null
          rationale?: string | null
          recommendation?: string
          required_approval_type?: string | null
          run_id?: string | null
          severity?: string | null
          status?: string
          suggested_action?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approval_type: string
          assigned_approver: string | null
          created_at: string
          decided_at: string | null
          decision:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes: string | null
          executed_at: string | null
          executed_by: string | null
          execution_error: string | null
          execution_status: string
          id: string
          linked_record_id: string | null
          linked_record_type: string | null
          recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id: string | null
          requested_action: string | null
          requested_by: string | null
          requested_payload: Json | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approval_type: string
          assigned_approver?: string | null
          created_at?: string
          decided_at?: string | null
          decision?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes?: string | null
          executed_at?: string | null
          executed_by?: string | null
          execution_error?: string | null
          execution_status?: string
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id?: string | null
          requested_action?: string | null
          requested_by?: string | null
          requested_payload?: Json | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approval_type?: string
          assigned_approver?: string | null
          created_at?: string
          decided_at?: string | null
          decision?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          decision_notes?: string | null
          executed_at?: string | null
          executed_by?: string | null
          execution_error?: string | null
          execution_status?: string
          id?: string
          linked_record_id?: string | null
          linked_record_type?: string | null
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id?: string | null
          requested_action?: string | null
          requested_by?: string | null
          requested_payload?: Json | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          approved_at: string | null
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          content: Json
          created_at: string
          created_by_agent: string | null
          id: string
          related_opportunity_id: string
          reviewed_by: string | null
          status: Database["public"]["Enums"]["artifact_status"]
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          artifact_type: Database["public"]["Enums"]["artifact_type"]
          content?: Json
          created_at?: string
          created_by_agent?: string | null
          id?: string
          related_opportunity_id: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          artifact_type?: Database["public"]["Enums"]["artifact_type"]
          content?: Json
          created_at?: string
          created_by_agent?: string | null
          id?: string
          related_opportunity_id?: string
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["artifact_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role_snapshot: string[] | null
          actor_type: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          language: string | null
          reason: string | null
          request_id: string | null
          route: string | null
          timestamp: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role_snapshot?: string[] | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          language?: string | null
          reason?: string | null
          request_id?: string | null
          route?: string | null
          timestamp?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role_snapshot?: string[] | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          language?: string | null
          reason?: string | null
          request_id?: string | null
          route?: string | null
          timestamp?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          notified: number | null
          raised: number | null
          started_at: string
          trigger: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          notified?: number | null
          raised?: number | null
          started_at?: string
          trigger?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          notified?: number | null
          raised?: number | null
          started_at?: string
          trigger?: string
        }
        Relationships: []
      }
      award_evidence: {
        Row: {
          confidence_score: number | null
          created_at: string
          date_received: string | null
          document_url: string | null
          evidence_type: string | null
          id: string
          linked_record_id: string
          linked_record_type: string
          note: string | null
          source: string | null
          uploaded_by: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          date_received?: string | null
          document_url?: string | null
          evidence_type?: string | null
          id?: string
          linked_record_id: string
          linked_record_type: string
          note?: string | null
          source?: string | null
          uploaded_by?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          date_received?: string | null
          document_url?: string | null
          evidence_type?: string | null
          id?: string
          linked_record_id?: string
          linked_record_type?: string
          note?: string | null
          source?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      bafo_requests: {
        Row: {
          commercial_review_at: string | null
          commercial_review_by: string | null
          commercial_review_notes: string | null
          commercial_review_status: string
          cost_approval_at: string | null
          cost_approval_by: string | null
          cost_approval_notes: string | null
          cost_approval_status: string
          created_at: string
          final_approval_at: string | null
          final_approval_by: string | null
          final_approval_notes: string | null
          final_approval_status: string
          finance_review_at: string | null
          finance_review_by: string | null
          finance_review_notes: string | null
          finance_review_status: string
          id: string
          justification: string
          opportunity_id: string
          proposed_discount_pct: number | null
          proposed_payment_terms: string | null
          proposed_value: number | null
          quotation_id: string | null
          requested_by: string
          sent_to_client_at: string | null
          sent_to_client_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          commercial_review_at?: string | null
          commercial_review_by?: string | null
          commercial_review_notes?: string | null
          commercial_review_status?: string
          cost_approval_at?: string | null
          cost_approval_by?: string | null
          cost_approval_notes?: string | null
          cost_approval_status?: string
          created_at?: string
          final_approval_at?: string | null
          final_approval_by?: string | null
          final_approval_notes?: string | null
          final_approval_status?: string
          finance_review_at?: string | null
          finance_review_by?: string | null
          finance_review_notes?: string | null
          finance_review_status?: string
          id?: string
          justification: string
          opportunity_id: string
          proposed_discount_pct?: number | null
          proposed_payment_terms?: string | null
          proposed_value?: number | null
          quotation_id?: string | null
          requested_by: string
          sent_to_client_at?: string | null
          sent_to_client_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          commercial_review_at?: string | null
          commercial_review_by?: string | null
          commercial_review_notes?: string | null
          commercial_review_status?: string
          cost_approval_at?: string | null
          cost_approval_by?: string | null
          cost_approval_notes?: string | null
          cost_approval_status?: string
          created_at?: string
          final_approval_at?: string | null
          final_approval_by?: string | null
          final_approval_notes?: string | null
          final_approval_status?: string
          finance_review_at?: string | null
          finance_review_by?: string | null
          finance_review_notes?: string | null
          finance_review_status?: string
          id?: string
          justification?: string
          opportunity_id?: string
          proposed_discount_pct?: number | null
          proposed_payment_terms?: string | null
          proposed_value?: number | null
          quotation_id?: string | null
          requested_by?: string
          sent_to_client_at?: string | null
          sent_to_client_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bafo_requests_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bafo_requests_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bafo_requests_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_extractions: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          related_opportunity_id: string | null
          source_file_url: string | null
          source_type: string | null
          status: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          related_opportunity_id?: string | null
          source_file_url?: string | null
          source_type?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          related_opportunity_id?: string | null
          source_file_url?: string | null
          source_type?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_extractions_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_extractions_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_items: {
        Row: {
          boq_id: string
          confidence: Database["public"]["Enums"]["confidence_level"]
          cost_estimate: number | null
          created_at: string
          finish: string | null
          id: string
          illumination: string | null
          item_source: string | null
          location: string | null
          material: string | null
          mounting: string | null
          quantity: number | null
          selling_price: number | null
          sign_type: string
          size: string | null
          sort_order: number | null
          unit_rate: number | null
        }
        Insert: {
          boq_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          cost_estimate?: number | null
          created_at?: string
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number | null
          selling_price?: number | null
          sign_type: string
          size?: string | null
          sort_order?: number | null
          unit_rate?: number | null
        }
        Update: {
          boq_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"]
          cost_estimate?: number | null
          created_at?: string
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number | null
          selling_price?: number | null
          sign_type?: string
          size?: string | null
          sort_order?: number | null
          unit_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_cost_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_sales_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_lines: {
        Row: {
          created_at: string
          description: string | null
          dimensions: string | null
          finish: string | null
          id: string
          illumination: string | null
          item_source: string | null
          line_number: number | null
          line_total: number | null
          location: string | null
          material: string | null
          mounting: string | null
          quantity: number
          revision_id: string
          selling_price: number | null
          sign_type: string
          sort_order: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          dimensions?: string | null
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          line_number?: number | null
          line_total?: number | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number
          revision_id: string
          selling_price?: number | null
          sign_type: string
          sort_order?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          dimensions?: string | null
          finish?: string | null
          id?: string
          illumination?: string | null
          item_source?: string | null
          line_number?: number | null
          line_total?: number | null
          location?: string | null
          material?: string | null
          mounting?: string | null
          quantity?: number
          revision_id?: string
          selling_price?: number | null
          sign_type?: string
          sort_order?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_revisions: {
        Row: {
          boq_id: string
          created_at: string
          created_by: string | null
          frozen_at: string | null
          frozen_by: string | null
          id: string
          is_current: boolean
          notes: string | null
          revision_number: number
          source_ref: string | null
          source_type: Database["public"]["Enums"]["boq_source_type"]
          status: Database["public"]["Enums"]["boq_revision_status"]
          superseded_at: string | null
          superseded_by: string | null
        }
        Insert: {
          boq_id: string
          created_at?: string
          created_by?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_current?: boolean
          notes?: string | null
          revision_number: number
          source_ref?: string | null
          source_type?: Database["public"]["Enums"]["boq_source_type"]
          status?: Database["public"]["Enums"]["boq_revision_status"]
          superseded_at?: string | null
          superseded_by?: string | null
        }
        Update: {
          boq_id?: string
          created_at?: string
          created_by?: string | null
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_current?: boolean
          notes?: string | null
          revision_number?: number
          source_ref?: string | null
          source_type?: Database["public"]["Enums"]["boq_source_type"]
          status?: Database["public"]["Enums"]["boq_revision_status"]
          superseded_at?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_cost_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_sales_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_revisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "boq_revisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      boqs: {
        Row: {
          assumptions: string | null
          created_at: string
          created_by: string | null
          currency: string
          estimated_value: number | null
          extra_data: Json | null
          file_url: string | null
          id: string
          missing_items: string | null
          notes: string | null
          related_opportunity_id: string
          source: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          status: Database["public"]["Enums"]["boq_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assumptions?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value?: number | null
          extra_data?: Json | null
          file_url?: string | null
          id?: string
          missing_items?: string | null
          notes?: string | null
          related_opportunity_id: string
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          status?: Database["public"]["Enums"]["boq_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assumptions?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value?: number | null
          extra_data?: Json | null
          file_url?: string | null
          id?: string
          missing_items?: string | null
          notes?: string | null
          related_opportunity_id?: string
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          status?: Database["public"]["Enums"]["boq_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          browser: Json | null
          category: string | null
          env: string | null
          error_msg: string | null
          error_name: string | null
          error_stack: string | null
          extra: Json | null
          id: string
          language: string | null
          received_at: string
          release: string | null
          request_id: string | null
          role: string | null
          route: string | null
          severity: string | null
        }
        Insert: {
          browser?: Json | null
          category?: string | null
          env?: string | null
          error_msg?: string | null
          error_name?: string | null
          error_stack?: string | null
          extra?: Json | null
          id?: string
          language?: string | null
          received_at?: string
          release?: string | null
          request_id?: string | null
          role?: string | null
          route?: string | null
          severity?: string | null
        }
        Update: {
          browser?: Json | null
          category?: string | null
          env?: string | null
          error_msg?: string | null
          error_name?: string | null
          error_stack?: string | null
          extra?: Json | null
          id?: string
          language?: string | null
          received_at?: string
          release?: string | null
          request_id?: string | null
          role?: string | null
          route?: string | null
          severity?: string | null
        }
        Relationships: []
      }
      commitments: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          description: string
          direction: Database["public"]["Enums"]["commitment_direction"]
          due_date: string
          id: string
          opportunity_id: string
          outcome_note: string | null
          owner_id: string | null
          source_activity_id: string | null
          status: Database["public"]["Enums"]["commitment_status"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          direction: Database["public"]["Enums"]["commitment_direction"]
          due_date: string
          id?: string
          opportunity_id: string
          outcome_note?: string | null
          owner_id?: string | null
          source_activity_id?: string | null
          status?: Database["public"]["Enums"]["commitment_status"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          direction?: Database["public"]["Enums"]["commitment_direction"]
          due_date?: string
          id?: string
          opportunity_id?: string
          outcome_note?: string | null
          owner_id?: string | null
          source_activity_id?: string | null
          status?: Database["public"]["Enums"]["commitment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commitments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_source_activity_id_fkey"
            columns: ["source_activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["activity_type"]
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["activity_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          account_owner_id: string | null
          account_status: Database["public"]["Enums"]["account_status"]
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          cr_number: string | null
          created_at: string
          created_by: string | null
          extra_data: Json | null
          id: string
          internal_notes: string | null
          last_contact_at: string | null
          name: string
          next_action: string | null
          next_action_due: string | null
          regions: string | null
          relationship_level: string | null
          source: string | null
          updated_at: string
          upsell_notes: string | null
          website: string | null
          website_domain: string | null
        }
        Insert: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          cr_number?: string | null
          created_at?: string
          created_by?: string | null
          extra_data?: Json | null
          id?: string
          internal_notes?: string | null
          last_contact_at?: string | null
          name: string
          next_action?: string | null
          next_action_due?: string | null
          regions?: string | null
          relationship_level?: string | null
          source?: string | null
          updated_at?: string
          upsell_notes?: string | null
          website?: string | null
          website_domain?: string | null
        }
        Update: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          cr_number?: string | null
          created_at?: string
          created_by?: string | null
          extra_data?: Json | null
          id?: string
          internal_notes?: string | null
          last_contact_at?: string | null
          name?: string
          next_action?: string | null
          next_action_due?: string | null
          regions?: string | null
          relationship_level?: string | null
          source?: string | null
          updated_at?: string
          upsell_notes?: string | null
          website?: string | null
          website_domain?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          authority: Database["public"]["Enums"]["contact_authority"]
          company_id: string | null
          confidence_level:
            | Database["public"]["Enums"]["contact_confidence_level"]
            | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          email: string | null
          extra_data: Json | null
          id: string
          last_verified_at: string | null
          linkedin: string | null
          location: Database["public"]["Enums"]["contact_location"]
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          source: string | null
          title: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_level?:
            | Database["public"]["Enums"]["contact_confidence_level"]
            | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          extra_data?: Json | null
          id?: string
          last_verified_at?: string | null
          linkedin?: string | null
          location?: Database["public"]["Enums"]["contact_location"]
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_level?:
            | Database["public"]["Enums"]["contact_confidence_level"]
            | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          extra_data?: Json | null
          id?: string
          last_verified_at?: string | null
          linkedin?: string | null
          location?: Database["public"]["Enums"]["contact_location"]
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          title?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          client: string | null
          contract_name: string | null
          contract_reference_number: string | null
          contract_value: number | null
          created_at: string
          created_by: string | null
          currency: string
          document_url: string | null
          end_date: string | null
          id: string
          notes: string | null
          opportunity_id: string
          responsible_user_id: string | null
          stage: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          client?: string | null
          contract_name?: string | null
          contract_reference_number?: string | null
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_url?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          opportunity_id: string
          responsible_user_id?: string | null
          stage?: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          client?: string | null
          contract_name?: string | null
          contract_reference_number?: string | null
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_url?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string
          responsible_user_id?: string | null
          stage?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_backfill_report: {
        Row: {
          derived_path: string | null
          id: string
          outcome: string
          raw_value: string | null
          reason: string
          record_id: string
          reported_at: string
          source_column: string
          source_table: string
        }
        Insert: {
          derived_path?: string | null
          id?: string
          outcome: string
          raw_value?: string | null
          reason: string
          record_id: string
          reported_at?: string
          source_column: string
          source_table: string
        }
        Update: {
          derived_path?: string | null
          id?: string
          outcome?: string
          raw_value?: string | null
          reason?: string
          record_id?: string
          reported_at?: string
          source_column?: string
          source_table?: string
        }
        Relationships: []
      }
      document_links: {
        Row: {
          document_id: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["document_entity_type"]
          id: string
          link_role: string | null
          linked_at: string
          linked_by: string | null
          unlinked_at: string | null
          unlinked_by: string | null
        }
        Insert: {
          document_id: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["document_entity_type"]
          id?: string
          link_role?: string | null
          linked_at?: string
          linked_by?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Update: {
          document_id?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["document_entity_type"]
          id?: string
          link_role?: string | null
          linked_at?: string
          linked_by?: string | null
          unlinked_at?: string | null
          unlinked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          captured_lat: number | null
          captured_lon: number | null
          checksum: string | null
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          is_legacy: boolean
          mime_type: string | null
          notes: string | null
          original_filename: string
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          title: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          captured_lat?: number | null
          captured_lon?: number | null
          checksum?: string | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_legacy?: boolean
          mime_type?: string | null
          notes?: string | null
          original_filename: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          captured_lat?: number | null
          captured_lon?: number | null
          checksum?: string | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          doc_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          is_legacy?: boolean
          mime_type?: string | null
          notes?: string | null
          original_filename?: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          title?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_group_members: {
        Row: {
          created_at: string
          display_label: string | null
          entity_id: string
          entity_type: string
          group_id: string
          id: string
        }
        Insert: {
          created_at?: string
          display_label?: string | null
          entity_id: string
          entity_type: string
          group_id: string
          id?: string
        }
        Update: {
          created_at?: string
          display_label?: string | null
          entity_id?: string
          entity_type?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "duplicate_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_groups: {
        Row: {
          confidence: number | null
          created_at: string
          entity_type: string
          id: string
          match_reason: string | null
          matched_fields: string[] | null
          run_id: string | null
          status: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          entity_type: string
          id?: string
          match_reason?: string | null
          matched_fields?: string[] | null
          run_id?: string | null
          status?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          entity_type?: string
          id?: string
          match_reason?: string | null
          matched_fields?: string[] | null
          run_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_groups_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      estimations: {
        Row: {
          boq_revision_id: string
          cost_total: number | null
          created_at: string
          created_by: string | null
          id: string
          installation_cost: number | null
          notes: string | null
          overhead_pct: number | null
          submitted_at: string | null
          submitted_by: string | null
          wastage_pct: number | null
        }
        Insert: {
          boq_revision_id: string
          cost_total?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          installation_cost?: number | null
          notes?: string | null
          overhead_pct?: number | null
          submitted_at?: string | null
          submitted_by?: string | null
          wastage_pct?: number | null
        }
        Update: {
          boq_revision_id?: string
          cost_total?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          installation_cost?: number | null
          notes?: string | null
          overhead_pct?: number | null
          submitted_at?: string | null
          submitted_by?: string | null
          wastage_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_sources: {
        Row: {
          confidence_level: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          extracted_summary: string | null
          file_size: number | null
          file_type: string | null
          id: string
          related_opportunity_id: string
          source_date: string | null
          source_title: string
          source_type: string
          source_url: string | null
          uploaded_by: string | null
          vault_path: string | null
        }
        Insert: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          related_opportunity_id: string
          source_date?: string | null
          source_title: string
          source_type: string
          source_url?: string | null
          uploaded_by?: string | null
          vault_path?: string | null
        }
        Update: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          related_opportunity_id?: string
          source_date?: string | null
          source_title?: string
          source_type?: string
          source_url?: string | null
          uploaded_by?: string | null
          vault_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_sources_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_sources_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_boq_items: {
        Row: {
          created_at: string
          extraction_id: string
          id: string
          item_description: string | null
          quantity: number | null
          sign_type: string | null
          source_ref: string | null
          uncertain: boolean
          unit: string | null
        }
        Insert: {
          created_at?: string
          extraction_id: string
          id?: string
          item_description?: string | null
          quantity?: number | null
          sign_type?: string | null
          source_ref?: string | null
          uncertain?: boolean
          unit?: string | null
        }
        Update: {
          created_at?: string
          extraction_id?: string
          id?: string
          item_description?: string | null
          quantity?: number | null
          sign_type?: string | null
          source_ref?: string | null
          uncertain?: boolean
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_boq_items_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "boq_extractions"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          cadence_tier: Database["public"]["Enums"]["priority_tier"]
          channel: string | null
          created_at: string
          due_date: string
          extra_data: Json | null
          id: string
          last_contact_at: string | null
          notes: string | null
          opportunity_id: string
          owner_id: string | null
          status: Database["public"]["Enums"]["follow_up_status"]
          updated_at: string
        }
        Insert: {
          cadence_tier?: Database["public"]["Enums"]["priority_tier"]
          channel?: string | null
          created_at?: string
          due_date: string
          extra_data?: Json | null
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          opportunity_id: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Update: {
          cadence_tier?: Database["public"]["Enums"]["priority_tier"]
          channel?: string | null
          created_at?: string
          due_date?: string
          extra_data?: Json | null
          id?: string
          last_contact_at?: string | null
          notes?: string | null
          opportunity_id?: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["follow_up_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_promotion_requests: {
        Row: {
          amount_absent_reason: string | null
          amount_excl_vat: number | null
          company_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          decision_notes: string | null
          id: string
          mapping_notes: string | null
          owner_user_id: string | null
          project_name: string | null
          promoted_at: string | null
          promoted_by: string | null
          promoted_opportunity_id: string | null
          rejection_reason: string | null
          requested_at: string | null
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_id: string
          status: Database["public"]["Enums"]["historical_promotion_status"]
          status_canonical: string | null
          updated_at: string
        }
        Insert: {
          amount_absent_reason?: string | null
          amount_excl_vat?: number | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decision_notes?: string | null
          id?: string
          mapping_notes?: string | null
          owner_user_id?: string | null
          project_name?: string | null
          promoted_at?: string | null
          promoted_by?: string | null
          promoted_opportunity_id?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_id: string
          status?: Database["public"]["Enums"]["historical_promotion_status"]
          status_canonical?: string | null
          updated_at?: string
        }
        Update: {
          amount_absent_reason?: string | null
          amount_excl_vat?: number | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decision_notes?: string | null
          id?: string
          mapping_notes?: string | null
          owner_user_id?: string | null
          project_name?: string | null
          promoted_at?: string | null
          promoted_by?: string | null
          promoted_opportunity_id?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_id?: string
          status?: Database["public"]["Enums"]["historical_promotion_status"]
          status_canonical?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_promotion_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_promoted_opportunity_id_fkey"
            columns: ["promoted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_promoted_opportunity_id_fkey"
            columns: ["promoted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_batches: {
        Row: {
          header_rows: number
          id: string
          loaded_at: string
          loaded_by: string | null
          notes: string | null
          source_file: string
          source_rows: number | null
          source_sha256: string | null
          status: string
        }
        Insert: {
          header_rows?: number
          id?: string
          loaded_at?: string
          loaded_by?: string | null
          notes?: string | null
          source_file: string
          source_rows?: number | null
          source_sha256?: string | null
          status?: string
        }
        Update: {
          header_rows?: number
          id?: string
          loaded_at?: string
          loaded_by?: string | null
          notes?: string | null
          source_file?: string
          source_rows?: number | null
          source_sha256?: string | null
          status?: string
        }
        Relationships: []
      }
      historical_sales_company_candidates: {
        Row: {
          batch_id: string
          id: string
          occurrences: number
          raw_name: string
          resolved: boolean
          suggested_company_id: string | null
          suggestion_basis: string | null
        }
        Insert: {
          batch_id: string
          id?: string
          occurrences?: number
          raw_name: string
          resolved?: boolean
          suggested_company_id?: string | null
          suggestion_basis?: string | null
        }
        Update: {
          batch_id?: string
          id?: string
          occurrences?: number
          raw_name?: string
          resolved?: boolean
          suggested_company_id?: string | null
          suggestion_basis?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_sales_company_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_sales_company_candidates_suggested_company_id_fkey"
            columns: ["suggested_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_mapped: {
        Row: {
          amount_excl_vat: number | null
          amount_raw: string | null
          amount_unparsed: boolean
          base_code: string | null
          batch_id: string
          client_name_raw: string | null
          code_placeholder: boolean
          code_unparsed: boolean
          company_id: string | null
          company_matched: boolean
          contact_email: string | null
          contact_mobile: string | null
          contact_name: string | null
          currency: string
          date_received: string | null
          date_submitted: string | null
          mapped_at: string
          owner_label: string | null
          owner_prefix: string | null
          owner_user_id: string | null
          project_location: string | null
          project_name_raw: string | null
          revision_no: number | null
          route: string | null
          row_id: string
          sales_code_raw: string | null
          status_canonical: string | null
          status_needs_decision: boolean
          status_raw: string | null
          variant: string | null
        }
        Insert: {
          amount_excl_vat?: number | null
          amount_raw?: string | null
          amount_unparsed?: boolean
          base_code?: string | null
          batch_id: string
          client_name_raw?: string | null
          code_placeholder?: boolean
          code_unparsed?: boolean
          company_id?: string | null
          company_matched?: boolean
          contact_email?: string | null
          contact_mobile?: string | null
          contact_name?: string | null
          currency?: string
          date_received?: string | null
          date_submitted?: string | null
          mapped_at?: string
          owner_label?: string | null
          owner_prefix?: string | null
          owner_user_id?: string | null
          project_location?: string | null
          project_name_raw?: string | null
          revision_no?: number | null
          route?: string | null
          row_id: string
          sales_code_raw?: string | null
          status_canonical?: string | null
          status_needs_decision?: boolean
          status_raw?: string | null
          variant?: string | null
        }
        Update: {
          amount_excl_vat?: number | null
          amount_raw?: string | null
          amount_unparsed?: boolean
          base_code?: string | null
          batch_id?: string
          client_name_raw?: string | null
          code_placeholder?: boolean
          code_unparsed?: boolean
          company_id?: string | null
          company_matched?: boolean
          contact_email?: string | null
          contact_mobile?: string | null
          contact_name?: string | null
          currency?: string
          date_received?: string | null
          date_submitted?: string | null
          mapped_at?: string
          owner_label?: string | null
          owner_prefix?: string | null
          owner_user_id?: string | null
          project_location?: string | null
          project_name_raw?: string | null
          revision_no?: number | null
          route?: string | null
          row_id?: string
          sales_code_raw?: string | null
          status_canonical?: string | null
          status_needs_decision?: boolean
          status_raw?: string | null
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_sales_mapped_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_sales_mapped_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_sales_mapped_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: true
            referencedRelation: "historical_sales_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_owner_map: {
        Row: {
          legacy_label: string
          note: string | null
          prefix: string
          user_id: string | null
        }
        Insert: {
          legacy_label: string
          note?: string | null
          prefix: string
          user_id?: string | null
        }
        Update: {
          legacy_label?: string
          note?: string | null
          prefix?: string
          user_id?: string | null
        }
        Relationships: []
      }
      historical_sales_rows: {
        Row: {
          batch_id: string
          id: string
          loaded_at: string
          raw: Json
          row_number: number
        }
        Insert: {
          batch_id: string
          id?: string
          loaded_at?: string
          raw: Json
          row_number: number
        }
        Update: {
          batch_id?: string
          id?: string
          loaded_at?: string
          raw?: Json
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_sales_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_status_map: {
        Row: {
          canonical_status: string | null
          is_terminal: boolean
          needs_decision: boolean
          note: string
          source_status: string
        }
        Insert: {
          canonical_status?: string | null
          is_terminal?: boolean
          needs_decision?: boolean
          note: string
          source_status: string
        }
        Update: {
          canonical_status?: string | null
          is_terminal?: boolean
          needs_decision?: boolean
          note?: string
          source_status?: string
        }
        Relationships: []
      }
      import_approval_queue: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          id: string
          reason: string | null
          requested_at: string
          requested_by: string
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by: string
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          requested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_approval_queue_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          ai_suggestions_enabled: boolean
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          archived_by: string | null
          committed_at: string | null
          created_at: string
          created_by: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          detected_header_row_index: number | null
          dry_run: boolean
          duplicate_rows: number
          error_rows: number
          file_fingerprint: string | null
          file_name: string | null
          id: string
          notes: string | null
          parser_version: string | null
          readiness_checklist: Json
          rolled_back_at: string | null
          rolled_back_by: string | null
          schema_signature: string | null
          source_profile_id: string | null
          source_type: string
          status: string
          structure_analysis: Json
          structure_confidence: number | null
          target_entity: string
          total_rows: number
          updated_at: string
          valid_rows: number
        }
        Insert: {
          ai_suggestions_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          committed_at?: string | null
          created_at?: string
          created_by: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          detected_header_row_index?: number | null
          dry_run?: boolean
          duplicate_rows?: number
          error_rows?: number
          file_fingerprint?: string | null
          file_name?: string | null
          id?: string
          notes?: string | null
          parser_version?: string | null
          readiness_checklist?: Json
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          schema_signature?: string | null
          source_profile_id?: string | null
          source_type?: string
          status?: string
          structure_analysis?: Json
          structure_confidence?: number | null
          target_entity?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Update: {
          ai_suggestions_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          committed_at?: string | null
          created_at?: string
          created_by?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          detected_header_row_index?: number | null
          dry_run?: boolean
          duplicate_rows?: number
          error_rows?: number
          file_fingerprint?: string | null
          file_name?: string | null
          id?: string
          notes?: string | null
          parser_version?: string | null
          readiness_checklist?: Json
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          schema_signature?: string | null
          source_profile_id?: string | null
          source_type?: string
          status?: string
          structure_analysis?: Json
          structure_confidence?: number | null
          target_entity?: string
          total_rows?: number
          updated_at?: string
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_source_profile_id_fkey"
            columns: ["source_profile_id"]
            isOneToOne: false
            referencedRelation: "import_source_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      import_candidate_links: {
        Row: {
          batch_id: string
          confidence: number | null
          created_at: string
          existing_relationship_id: string | null
          id: string
          reason: string | null
          relationship_type: string
          source_candidate_id: string
          target_candidate_id: string
        }
        Insert: {
          batch_id: string
          confidence?: number | null
          created_at?: string
          existing_relationship_id?: string | null
          id?: string
          reason?: string | null
          relationship_type: string
          source_candidate_id: string
          target_candidate_id: string
        }
        Update: {
          batch_id?: string
          confidence?: number | null
          created_at?: string
          existing_relationship_id?: string | null
          id?: string
          reason?: string | null
          relationship_type?: string
          source_candidate_id?: string
          target_candidate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_candidate_links_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_candidate_links_source_candidate_id_fkey"
            columns: ["source_candidate_id"]
            isOneToOne: false
            referencedRelation: "import_record_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_candidate_links_target_candidate_id_fkey"
            columns: ["target_candidate_id"]
            isOneToOne: false
            referencedRelation: "import_record_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      import_duplicate_candidates: {
        Row: {
          batch_id: string
          confidence: number
          created_at: string
          existing_record_id: string
          existing_table: string
          id: string
          match_scope: string
          match_type: string
          matched_fields: string[] | null
          reason_code: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          row_id: string
          suggested_action: string | null
        }
        Insert: {
          batch_id: string
          confidence?: number
          created_at?: string
          existing_record_id: string
          existing_table: string
          id?: string
          match_scope?: string
          match_type: string
          matched_fields?: string[] | null
          reason_code?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_id: string
          suggested_action?: string | null
        }
        Update: {
          batch_id?: string
          confidence?: number
          created_at?: string
          existing_record_id?: string
          existing_table?: string
          id?: string
          match_scope?: string
          match_type?: string
          matched_fields?: string[] | null
          reason_code?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_id?: string
          suggested_action?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_duplicate_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_duplicate_candidates_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          batch_id: string
          column_name: string | null
          created_at: string
          error_type: string
          id: string
          message: string
          row_id: string | null
          row_number: number | null
          severity: string
        }
        Insert: {
          batch_id: string
          column_name?: string | null
          created_at?: string
          error_type: string
          id?: string
          message: string
          row_id?: string | null
          row_number?: number | null
          severity?: string
        }
        Update: {
          batch_id?: string
          column_name?: string | null
          created_at?: string
          error_type?: string
          id?: string
          message?: string
          row_id?: string | null
          row_number?: number | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_errors_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_field_provenance: {
        Row: {
          batch_id: string
          candidate_id: string
          confidence: number | null
          created_at: string
          id: string
          normalised_value: string | null
          source_column: string
          source_row_id: string | null
          source_value: string | null
          transform_applied: string | null
        }
        Insert: {
          batch_id: string
          candidate_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          normalised_value?: string | null
          source_column: string
          source_row_id?: string | null
          source_value?: string | null
          transform_applied?: string | null
        }
        Update: {
          batch_id?: string
          candidate_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          normalised_value?: string | null
          source_column?: string
          source_row_id?: string | null
          source_value?: string | null
          transform_applied?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_field_provenance_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_field_provenance_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "import_record_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_field_provenance_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_files: {
        Row: {
          batch_id: string
          column_names: string[] | null
          created_at: string
          file_name: string
          file_size_bytes: number
          file_type: string
          header_row: number
          id: string
          row_count: number | null
          sheet_count: number
          sheet_name: string | null
          storage_path: string
        }
        Insert: {
          batch_id: string
          column_names?: string[] | null
          created_at?: string
          file_name: string
          file_size_bytes: number
          file_type: string
          header_row?: number
          id?: string
          row_count?: number | null
          sheet_count?: number
          sheet_name?: string | null
          storage_path: string
        }
        Update: {
          batch_id?: string
          column_names?: string[] | null
          created_at?: string
          file_name?: string
          file_size_bytes?: number
          file_type?: string
          header_row?: number
          id?: string
          row_count?: number | null
          sheet_count?: number
          sheet_name?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_mappings: {
        Row: {
          batch_id: string
          confidence_score: number | null
          created_at: string
          id: string
          is_key: boolean
          mapping_source: string
          source_column: string
          target_column: string
          target_table: string
          transform: string | null
        }
        Insert: {
          batch_id: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_key?: boolean
          mapping_source?: string
          source_column: string
          target_column: string
          target_table: string
          transform?: string | null
        }
        Update: {
          batch_id?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_key?: boolean
          mapping_source?: string
          source_column?: string
          target_column?: string
          target_table?: string
          transform?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_mappings_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_record_candidates: {
        Row: {
          batch_id: string
          changed_fields: string[]
          confidence: number | null
          created_at: string
          entity_type: string
          existing_record_id: string | null
          existing_table: string | null
          file_id: string | null
          id: string
          identity_key: string | null
          proposed_action: string
          proposed_payload: Json
          reason: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          sheet_id: string | null
          source_row_id: string | null
          updated_at: string
        }
        Insert: {
          batch_id: string
          changed_fields?: string[]
          confidence?: number | null
          created_at?: string
          entity_type: string
          existing_record_id?: string | null
          existing_table?: string | null
          file_id?: string | null
          id?: string
          identity_key?: string | null
          proposed_action?: string
          proposed_payload?: Json
          reason?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sheet_id?: string | null
          source_row_id?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string
          changed_fields?: string[]
          confidence?: number | null
          created_at?: string
          entity_type?: string
          existing_record_id?: string | null
          existing_table?: string | null
          file_id?: string | null
          id?: string
          identity_key?: string | null
          proposed_action?: string
          proposed_payload?: Json
          reason?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sheet_id?: string | null
          source_row_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_record_candidates_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_record_candidates_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_record_candidates_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "import_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_record_candidates_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_record_links: {
        Row: {
          action: string
          batch_id: string
          created_at: string
          id: string
          row_id: string
          target_id: string
          target_table: string
        }
        Insert: {
          action: string
          batch_id: string
          created_at?: string
          id?: string
          row_id: string
          target_id: string
          target_table: string
        }
        Update: {
          action?: string
          batch_id?: string
          created_at?: string
          id?: string
          row_id?: string
          target_id?: string
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_record_links_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_record_links_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          confidence_reasons: Json | null
          confidence_score: number | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edit_reason: string | null
          edited_at: string | null
          edited_by: string | null
          excluded_at: string | null
          excluded_by: string | null
          file_id: string
          id: string
          is_excluded: boolean
          mapped_data: Json | null
          needs_review: boolean
          normalized_data: Json | null
          original_row_number: number | null
          raw_data: Json
          review_status: string
          row_number: number
          row_status: string
          sheet_id: string | null
          status: string
          target_entity: string | null
        }
        Insert: {
          batch_id: string
          confidence_reasons?: Json | null
          confidence_score?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edit_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          excluded_at?: string | null
          excluded_by?: string | null
          file_id: string
          id?: string
          is_excluded?: boolean
          mapped_data?: Json | null
          needs_review?: boolean
          normalized_data?: Json | null
          original_row_number?: number | null
          raw_data: Json
          review_status?: string
          row_number: number
          row_status?: string
          sheet_id?: string | null
          status?: string
          target_entity?: string | null
        }
        Update: {
          batch_id?: string
          confidence_reasons?: Json | null
          confidence_score?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edit_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          excluded_at?: string | null
          excluded_by?: string | null
          file_id?: string
          id?: string
          is_excluded?: boolean
          mapped_data?: Json | null
          needs_review?: boolean
          normalized_data?: Json | null
          original_row_number?: number | null
          raw_data?: Json
          review_status?: string
          row_number?: number
          row_status?: string
          sheet_id?: string | null
          status?: string
          target_entity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "import_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      import_sheets: {
        Row: {
          ai_confidence: number | null
          batch_id: string
          column_manifest: Json
          created_at: string
          data_start_row: number
          detected_dataset_type: string | null
          file_id: string
          header_row_index: number
          id: string
          row_count: number
          sheet_index: number
          sheet_name: string
          status: string
          title_rows: number
        }
        Insert: {
          ai_confidence?: number | null
          batch_id: string
          column_manifest?: Json
          created_at?: string
          data_start_row?: number
          detected_dataset_type?: string | null
          file_id: string
          header_row_index?: number
          id?: string
          row_count?: number
          sheet_index: number
          sheet_name: string
          status?: string
          title_rows?: number
        }
        Update: {
          ai_confidence?: number | null
          batch_id?: string
          column_manifest?: Json
          created_at?: string
          data_start_row?: number
          detected_dataset_type?: string | null
          file_id?: string
          header_row_index?: number
          id?: string
          row_count?: number
          sheet_index?: number
          sheet_name?: string
          status?: string
          title_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_sheets_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_sheets_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "import_files"
            referencedColumns: ["id"]
          },
        ]
      }
      import_source_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expected_dataset_types: string[]
          id: string
          identity_rules: Json
          is_recurring: boolean
          known_column_aliases: Json
          last_imported_at: string | null
          last_successful_batch_id: string | null
          name: string
          owner_id: string | null
          routing_rules: Json
          schema_signature: string | null
          source_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_dataset_types?: string[]
          id?: string
          identity_rules?: Json
          is_recurring?: boolean
          known_column_aliases?: Json
          last_imported_at?: string | null
          last_successful_batch_id?: string | null
          name: string
          owner_id?: string | null
          routing_rules?: Json
          schema_signature?: string | null
          source_kind: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expected_dataset_types?: string[]
          id?: string
          identity_rules?: Json
          is_recurring?: boolean
          known_column_aliases?: Json
          last_imported_at?: string | null
          last_successful_batch_id?: string | null
          name?: string
          owner_id?: string | null
          routing_rules?: Json
          schema_signature?: string | null
          source_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_source_profiles_last_successful_batch_id_fkey"
            columns: ["last_successful_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_split_proposals: {
        Row: {
          ai_output_id: string | null
          batch_id: string
          created_at: string
          entity_type: string
          id: string
          proposed_payload: Json
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          role: string | null
          source_row_id: string
        }
        Insert: {
          ai_output_id?: string | null
          batch_id: string
          created_at?: string
          entity_type: string
          id?: string
          proposed_payload?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string | null
          source_row_id: string
        }
        Update: {
          ai_output_id?: string | null
          batch_id?: string
          created_at?: string
          entity_type?: string
          id?: string
          proposed_payload?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string | null
          source_row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_split_proposals_ai_output_id_fkey"
            columns: ["ai_output_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_outputs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_split_proposals_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_split_proposals_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_items: {
        Row: {
          archive_reason: string | null
          assigned_owner_id: string | null
          classification: Database["public"]["Enums"]["inbox_classification"]
          client_owner: string | null
          client_rfq_reference: string | null
          client_type: Database["public"]["Enums"]["inbox_client_type"] | null
          company_name: string | null
          consultant: string | null
          contact_name: string | null
          converted_record_id: string | null
          converted_record_type: string | null
          created_at: string
          created_by: string | null
          date_received: string
          deadline: string | null
          duplicate_of_id: string | null
          duplicate_of_type: string | null
          email: string | null
          estimated_value: number | null
          evidence_storage_path: string | null
          evidence_url: string | null
          follow_up_date: string | null
          has_boq: boolean
          has_drawings: boolean
          has_specs: boolean
          id: string
          info_comment: string | null
          info_due_date: string | null
          info_requested_at: string | null
          info_required_items: string[] | null
          info_responsible_id: string | null
          internal_rfq_reference: string | null
          location: string | null
          location_city: Database["public"]["Enums"]["inbox_location"] | null
          main_contractor: string | null
          missing_data_reason: string | null
          next_action: string | null
          notes: string | null
          owner_entity: string | null
          phone: string | null
          project_name: string | null
          project_number: string | null
          project_type: Database["public"]["Enums"]["inbox_project_type"] | null
          reject_reason: string | null
          request_type: string | null
          resubmit_count: number
          resubmitted_at: string | null
          review_notes: string | null
          review_state: string
          reviewed_at: string | null
          reviewed_by: string | null
          rfq_from: Database["public"]["Enums"]["inbox_rfq_from"] | null
          scope: string | null
          scope_type: Database["public"]["Enums"]["inbox_scope"] | null
          source_name: string | null
          source_type: Database["public"]["Enums"]["inbox_source_type"]
          status: Database["public"]["Enums"]["inbox_status"]
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          assigned_owner_id?: string | null
          classification?: Database["public"]["Enums"]["inbox_classification"]
          client_owner?: string | null
          client_rfq_reference?: string | null
          client_type?: Database["public"]["Enums"]["inbox_client_type"] | null
          company_name?: string | null
          consultant?: string | null
          contact_name?: string | null
          converted_record_id?: string | null
          converted_record_type?: string | null
          created_at?: string
          created_by?: string | null
          date_received?: string
          deadline?: string | null
          duplicate_of_id?: string | null
          duplicate_of_type?: string | null
          email?: string | null
          estimated_value?: number | null
          evidence_storage_path?: string | null
          evidence_url?: string | null
          follow_up_date?: string | null
          has_boq?: boolean
          has_drawings?: boolean
          has_specs?: boolean
          id?: string
          info_comment?: string | null
          info_due_date?: string | null
          info_requested_at?: string | null
          info_required_items?: string[] | null
          info_responsible_id?: string | null
          internal_rfq_reference?: string | null
          location?: string | null
          location_city?: Database["public"]["Enums"]["inbox_location"] | null
          main_contractor?: string | null
          missing_data_reason?: string | null
          next_action?: string | null
          notes?: string | null
          owner_entity?: string | null
          phone?: string | null
          project_name?: string | null
          project_number?: string | null
          project_type?:
            | Database["public"]["Enums"]["inbox_project_type"]
            | null
          reject_reason?: string | null
          request_type?: string | null
          resubmit_count?: number
          resubmitted_at?: string | null
          review_notes?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rfq_from?: Database["public"]["Enums"]["inbox_rfq_from"] | null
          scope?: string | null
          scope_type?: Database["public"]["Enums"]["inbox_scope"] | null
          source_name?: string | null
          source_type: Database["public"]["Enums"]["inbox_source_type"]
          status?: Database["public"]["Enums"]["inbox_status"]
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          assigned_owner_id?: string | null
          classification?: Database["public"]["Enums"]["inbox_classification"]
          client_owner?: string | null
          client_rfq_reference?: string | null
          client_type?: Database["public"]["Enums"]["inbox_client_type"] | null
          company_name?: string | null
          consultant?: string | null
          contact_name?: string | null
          converted_record_id?: string | null
          converted_record_type?: string | null
          created_at?: string
          created_by?: string | null
          date_received?: string
          deadline?: string | null
          duplicate_of_id?: string | null
          duplicate_of_type?: string | null
          email?: string | null
          estimated_value?: number | null
          evidence_storage_path?: string | null
          evidence_url?: string | null
          follow_up_date?: string | null
          has_boq?: boolean
          has_drawings?: boolean
          has_specs?: boolean
          id?: string
          info_comment?: string | null
          info_due_date?: string | null
          info_requested_at?: string | null
          info_required_items?: string[] | null
          info_responsible_id?: string | null
          internal_rfq_reference?: string | null
          location?: string | null
          location_city?: Database["public"]["Enums"]["inbox_location"] | null
          main_contractor?: string | null
          missing_data_reason?: string | null
          next_action?: string | null
          notes?: string | null
          owner_entity?: string | null
          phone?: string | null
          project_name?: string | null
          project_number?: string | null
          project_type?:
            | Database["public"]["Enums"]["inbox_project_type"]
            | null
          reject_reason?: string | null
          request_type?: string | null
          resubmit_count?: number
          resubmitted_at?: string | null
          review_notes?: string | null
          review_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          rfq_from?: Database["public"]["Enums"]["inbox_rfq_from"] | null
          scope?: string | null
          scope_type?: Database["public"]["Enums"]["inbox_scope"] | null
          source_name?: string | null
          source_type?: Database["public"]["Enums"]["inbox_source_type"]
          status?: Database["public"]["Enums"]["inbox_status"]
          updated_at?: string
        }
        Relationships: []
      }
      internal_prices: {
        Row: {
          below_floor_justification: string | null
          commercial_reviewed_at: string | null
          commercial_reviewed_by: string | null
          created_at: string
          estimation_id: string
          finance_reviewed_at: string | null
          finance_reviewed_by: string | null
          gm_decided_at: string | null
          gm_decided_by: string | null
          id: string
          margin_percentage: number | null
          margin_value: number | null
          proposed_at: string | null
          proposed_by: string | null
          proposed_price: number | null
          return_reason: string | null
          status: Database["public"]["Enums"]["internal_price_status"]
          updated_at: string
        }
        Insert: {
          below_floor_justification?: string | null
          commercial_reviewed_at?: string | null
          commercial_reviewed_by?: string | null
          created_at?: string
          estimation_id: string
          finance_reviewed_at?: string | null
          finance_reviewed_by?: string | null
          gm_decided_at?: string | null
          gm_decided_by?: string | null
          id?: string
          margin_percentage?: number | null
          margin_value?: number | null
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_price?: number | null
          return_reason?: string | null
          status?: Database["public"]["Enums"]["internal_price_status"]
          updated_at?: string
        }
        Update: {
          below_floor_justification?: string | null
          commercial_reviewed_at?: string | null
          commercial_reviewed_by?: string | null
          created_at?: string
          estimation_id?: string
          finance_reviewed_at?: string | null
          finance_reviewed_by?: string | null
          gm_decided_at?: string | null
          gm_decided_by?: string | null
          id?: string
          margin_percentage?: number | null
          margin_value?: number | null
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_price?: number | null
          return_reason?: string | null
          status?: Database["public"]["Enums"]["internal_price_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimation_cost_reconciliation"
            referencedColumns: ["estimation_id"]
          },
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          source_id: string | null
          source_type: string
          title: string | null
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type: string
          title?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string | null
          source_type?: string
          title?: string | null
        }
        Relationships: []
      }
      lead_scores: {
        Row: {
          band: string
          created_at: string
          evidence: Json | null
          id: string
          lead_id: string
          missing_information: string[] | null
          next_best_action: string | null
          reason_codes: string[] | null
          run_id: string | null
          score: number
        }
        Insert: {
          band: string
          created_at?: string
          evidence?: Json | null
          id?: string
          lead_id: string
          missing_information?: string[] | null
          next_best_action?: string | null
          reason_codes?: string[] | null
          run_id?: string | null
          score: number
        }
        Update: {
          band?: string
          created_at?: string
          evidence?: Json | null
          id?: string
          lead_id?: string
          missing_information?: string[] | null
          next_best_action?: string | null
          reason_codes?: string[] | null
          run_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_review_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_scores_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          converted_opportunity_id: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string | null
          duplicate_of: string | null
          duplicate_of_lead_id: string | null
          estimated_value: number | null
          extra_data: Json | null
          id: string
          lead_score: number | null
          lead_stage: Database["public"]["Enums"]["lead_stage"]
          location: string | null
          main_contractor_guess: string | null
          owner_id: string | null
          project_name: string
          project_stage_estimate:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason: string | null
          research_notes: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          duplicate_of?: string | null
          duplicate_of_lead_id?: string | null
          estimated_value?: number | null
          extra_data?: Json | null
          id?: string
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"]
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name: string
          project_stage_estimate?:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason?: string | null
          research_notes?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string | null
          duplicate_of?: string | null
          duplicate_of_lead_id?: string | null
          estimated_value?: number | null
          extra_data?: Json | null
          id?: string
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"]
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name?: string
          project_stage_estimate?:
            | Database["public"]["Enums"]["project_stage"]
            | null
          rejection_reason?: string | null
          research_notes?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_lead_id_fkey"
            columns: ["duplicate_of_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_review_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_lead_id_fkey"
            columns: ["duplicate_of_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      margin_policies: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          min_margin_pct: number
          rationale: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          min_margin_pct: number
          rationale?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          min_margin_pct?: number
          rationale?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string
          dismissed_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          notification_type: string
          read_at: string | null
          recipient_user_id: string
          severity: string
          source_event: string
          source_event_id: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          notification_type: string
          read_at?: string | null
          recipient_user_id: string
          severity?: string
          source_event: string
          source_event_id?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string
          dismissed_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          notification_type?: string
          read_at?: string | null
          recipient_user_id?: string
          severity?: string
          source_event?: string
          source_event_id?: string | null
          title?: string
        }
        Relationships: []
      }
      operations_handovers: {
        Row: {
          approved_value: number | null
          commercial_owner_id: string | null
          contract_document_url: string | null
          created_at: string
          created_by: string | null
          handover_checklist_status: string
          handover_date: string | null
          id: string
          operations_owner_id: string | null
          opportunity_id: string
          updated_at: string
        }
        Insert: {
          approved_value?: number | null
          commercial_owner_id?: string | null
          contract_document_url?: string | null
          created_at?: string
          created_by?: string | null
          handover_checklist_status?: string
          handover_date?: string | null
          id?: string
          operations_owner_id?: string | null
          opportunity_id: string
          updated_at?: string
        }
        Update: {
          approved_value?: number | null
          commercial_owner_id?: string | null
          contract_document_url?: string | null
          created_at?: string
          created_by?: string | null
          handover_checklist_status?: string
          handover_date?: string | null
          id?: string
          operations_owner_id?: string | null
          opportunity_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_handovers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_handovers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          action_priority: Database["public"]["Enums"]["priority_tier"] | null
          action_required: boolean
          agent_reasoning: string | null
          agent_recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client: string | null
          commercial_handoff_at: string | null
          commercial_handoff_by: string | null
          commercial_handoff_note: string | null
          commercial_handoff_status: string
          company_id: string | null
          contract_received_date: string | null
          contract_reference_number: string | null
          contract_signed_date: string | null
          contract_value: number | null
          contractor_decision_maker: string | null
          created_at: string
          created_by: string | null
          currency: string
          estimated_value_max: number | null
          estimated_value_min: number | null
          evidence_count: number
          exclusion_reason:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date: string | null
          extra_data: Json | null
          flow_type: Database["public"]["Enums"]["flow_type"]
          handover_status: Database["public"]["Enums"]["handover_status"] | null
          hold_reason: string | null
          hold_review_date: string | null
          human_probability_at: string | null
          human_probability_by: string | null
          human_probability_reason: string | null
          human_win_probability: number | null
          id: string
          last_activity_at: string | null
          location: string | null
          loss_notes: string | null
          loss_reason: string | null
          lost_at: string | null
          lost_at_stage: string | null
          lost_to_competitor: string | null
          main_contractor: string | null
          main_contractor_confirmed: boolean
          main_contractor_id: string | null
          management_review_reason: string | null
          next_action: string | null
          next_action_due: string | null
          owner_id: string | null
          package_budget_confirmed: boolean
          person_in_charge_id: string | null
          person_in_charge_note: string | null
          pipeline_step: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status: string | null
          project_id: string | null
          project_name: string
          project_stage: Database["public"]["Enums"]["project_stage"]
          quotation_value: number | null
          sales_stage: Database["public"]["Enums"]["sales_stage"] | null
          score: number | null
          score_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override: boolean
          score_missing_data: string[] | null
          score_override_reason: string | null
          score_reasons: string[] | null
          score_recommended_action: string | null
          score_risk_flags: string[] | null
          score_tier:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at: string | null
          scored_by: string | null
          sector: string | null
          signage_package_confidence: Database["public"]["Enums"]["confidence_level"]
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          source_tender_id: string | null
          stage: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value: string | null
          technical_notes: string | null
          tier: Database["public"]["Enums"]["priority_tier"]
          updated_at: string
          verbal_award_contact_name: string | null
          verbal_award_contact_title: string | null
          verbal_award_date: string | null
          verbal_award_evidence: string | null
          verbal_award_method: string | null
          win_confidence: Database["public"]["Enums"]["win_confidence"] | null
          won_at: string | null
        }
        Insert: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          commercial_handoff_at?: string | null
          commercial_handoff_by?: string | null
          commercial_handoff_note?: string | null
          commercial_handoff_status?: string
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_signed_date?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          extra_data?: Json | null
          flow_type?: Database["public"]["Enums"]["flow_type"]
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          human_probability_at?: string | null
          human_probability_by?: string | null
          human_probability_reason?: string | null
          human_win_probability?: number | null
          id?: string
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          lost_at_stage?: string | null
          lost_to_competitor?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          score?: number | null
          score_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override?: boolean
          score_missing_data?: string[] | null
          score_override_reason?: string | null
          score_reasons?: string[] | null
          score_recommended_action?: string | null
          score_risk_flags?: string[] | null
          score_tier?:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at?: string | null
          scored_by?: string | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          source_tender_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          technical_notes?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
          won_at?: string | null
        }
        Update: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          commercial_handoff_at?: string | null
          commercial_handoff_by?: string | null
          commercial_handoff_note?: string | null
          commercial_handoff_status?: string
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_signed_date?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          extra_data?: Json | null
          flow_type?: Database["public"]["Enums"]["flow_type"]
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          human_probability_at?: string | null
          human_probability_by?: string | null
          human_probability_reason?: string | null
          human_win_probability?: number | null
          id?: string
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          lost_at_stage?: string | null
          lost_to_competitor?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name?: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          score?: number | null
          score_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override?: boolean
          score_missing_data?: string[] | null
          score_override_reason?: string | null
          score_reasons?: string[] | null
          score_recommended_action?: string | null
          score_risk_flags?: string[] | null
          score_tier?:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at?: string | null
          scored_by?: string | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          source_tender_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          technical_notes?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_source_tender_id_fkey"
            columns: ["source_tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_discussions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          mention_purpose: string | null
          mentioned_user_id: string | null
          opportunity_id: string
          person_in_charge_id: string | null
          person_in_charge_note: string | null
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          mention_purpose?: string | null
          mentioned_user_id?: string | null
          opportunity_id: string
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mention_purpose?: string | null
          mentioned_user_id?: string | null
          opportunity_id?: string
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_discussions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_discussions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_flags: {
        Row: {
          action_owner_id: string | null
          action_type: Database["public"]["Enums"]["action_type"] | null
          ai_generated: boolean
          completed_at: string | null
          completed_by: string | null
          condition_key: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          flag_kind: Database["public"]["Enums"]["flag_kind"]
          id: string
          linked_record_id: string
          linked_record_type: string
          priority: Database["public"]["Enums"]["priority_tier"] | null
          queue_action_type:
            | Database["public"]["Enums"]["queue_action_type"]
            | null
          reason: string | null
          recommended_action: string | null
          risk_flag: Database["public"]["Enums"]["risk_flag"] | null
          status: Database["public"]["Enums"]["flag_status"]
          updated_at: string
        }
        Insert: {
          action_owner_id?: string | null
          action_type?: Database["public"]["Enums"]["action_type"] | null
          ai_generated?: boolean
          completed_at?: string | null
          completed_by?: string | null
          condition_key?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          flag_kind: Database["public"]["Enums"]["flag_kind"]
          id?: string
          linked_record_id: string
          linked_record_type: string
          priority?: Database["public"]["Enums"]["priority_tier"] | null
          queue_action_type?:
            | Database["public"]["Enums"]["queue_action_type"]
            | null
          reason?: string | null
          recommended_action?: string | null
          risk_flag?: Database["public"]["Enums"]["risk_flag"] | null
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Update: {
          action_owner_id?: string | null
          action_type?: Database["public"]["Enums"]["action_type"] | null
          ai_generated?: boolean
          completed_at?: string | null
          completed_by?: string | null
          condition_key?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          flag_kind?: Database["public"]["Enums"]["flag_kind"]
          id?: string
          linked_record_id?: string
          linked_record_type?: string
          priority?: Database["public"]["Enums"]["priority_tier"] | null
          queue_action_type?:
            | Database["public"]["Enums"]["queue_action_type"]
            | null
          reason?: string | null
          recommended_action?: string | null
          risk_flag?: Database["public"]["Enums"]["risk_flag"] | null
          status?: Database["public"]["Enums"]["flag_status"]
          updated_at?: string
        }
        Relationships: []
      }
      opportunity_milestones: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          milestone: Database["public"]["Enums"]["opportunity_milestone"]
          opportunity_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          milestone: Database["public"]["Enums"]["opportunity_milestone"]
          opportunity_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          milestone?: Database["public"]["Enums"]["opportunity_milestone"]
          opportunity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_milestones_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_milestones_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      price_authority_delegations: {
        Row: {
          created_at: string
          expires_at: string
          grantee_id: string
          grantor_id: string
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          grantee_id: string
          grantor_id: string
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          grantee_id?: string
          grantor_id?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          starts_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string
          sales_code: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          language?: string
          sales_code?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string
          sales_code?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      project_budget_items: {
        Row: {
          actual_amount: number | null
          category: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          notes: string | null
          planned_amount: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          actual_amount?: number | null
          category: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          notes?: string | null
          planned_amount?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          actual_amount?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          notes?: string | null
          planned_amount?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_job_stages: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_job_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_jobs: {
        Row: {
          ai_notes: string | null
          assignee_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          position: number
          project_id: string
          stage_id: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_notes?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          project_id: string
          stage_id: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_notes?: string | null
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          position?: number
          project_id?: string
          stage_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_jobs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "project_job_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          completion_pct: number | null
          consultant_id: string | null
          cover_image_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          expected_boq_date: string | null
          expected_signage_date: string | null
          extra_data: Json | null
          id: string
          location: string | null
          main_contractor_id: string | null
          name: string
          notes: string | null
          owner_company_id: string | null
          project_number: string | null
          project_stage: Database["public"]["Enums"]["project_stage"]
          sector: string | null
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          site_address: string | null
          site_latitude: number | null
          site_longitude: number | null
          source: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          total_value: number | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          completion_pct?: number | null
          consultant_id?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          extra_data?: Json | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name: string
          notes?: string | null
          owner_company_id?: string | null
          project_number?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          site_address?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          total_value?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          completion_pct?: number | null
          consultant_id?: string | null
          cover_image_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          extra_data?: Json | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name?: string
          notes?: string | null
          owner_company_id?: string | null
          project_number?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          site_address?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          total_value?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "projects_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_company_id_fkey"
            columns: ["owner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      protenders_imports: {
        Row: {
          created_at: string
          filename: string | null
          format: string | null
          id: string
          notes: string | null
          row_count: number
          source: string
          status: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          format?: string | null
          id?: string
          notes?: string | null
          row_count?: number
          source?: string
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          format?: string | null
          id?: string
          notes?: string | null
          row_count?: number
          source?: string
          status?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      protenders_projects: {
        Row: {
          created_at: string
          evidence_text: string | null
          evidence_url: string | null
          id: string
          import_id: string | null
          main_contractor: string | null
          package: string | null
          project_name: string | null
          raw: Json | null
          source_date: string | null
          stage: string | null
        }
        Insert: {
          created_at?: string
          evidence_text?: string | null
          evidence_url?: string | null
          id?: string
          import_id?: string | null
          main_contractor?: string | null
          package?: string | null
          project_name?: string | null
          raw?: Json | null
          source_date?: string | null
          stage?: string | null
        }
        Update: {
          created_at?: string
          evidence_text?: string | null
          evidence_url?: string | null
          id?: string
          import_id?: string | null
          main_contractor?: string | null
          package?: string | null
          project_name?: string | null
          raw?: Json | null
          source_date?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protenders_projects_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "protenders_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_revisions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          boq_revision_id: string | null
          client_reference: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivery_terms: string | null
          id: string
          internal_price_id: string | null
          is_current: boolean
          issued_at: string | null
          payment_terms: string | null
          quotation_id: string
          return_reason: string | null
          revision_number: number
          scope_summary: string | null
          status: Database["public"]["Enums"]["quotation_revision_status"]
          submitted_at: string | null
          submitted_by: string | null
          subtotal_excl_vat: number
          supersedes_id: string | null
          total_incl_vat: number | null
          updated_at: string
          valid_until: string | null
          vat_amount: number | null
          vat_rate: number
          withdrawn_reason: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          boq_revision_id?: string | null
          client_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          internal_price_id?: string | null
          is_current?: boolean
          issued_at?: string | null
          payment_terms?: string | null
          quotation_id: string
          return_reason?: string | null
          revision_number?: number
          scope_summary?: string | null
          status?: Database["public"]["Enums"]["quotation_revision_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_excl_vat: number
          supersedes_id?: string | null
          total_incl_vat?: number | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number | null
          vat_rate?: number
          withdrawn_reason?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          boq_revision_id?: string | null
          client_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          internal_price_id?: string | null
          is_current?: boolean
          issued_at?: string | null
          payment_terms?: string | null
          quotation_id?: string
          return_reason?: string | null
          revision_number?: number
          scope_summary?: string | null
          status?: Database["public"]["Enums"]["quotation_revision_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          subtotal_excl_vat?: number
          supersedes_id?: string | null
          total_incl_vat?: number | null
          updated_at?: string
          valid_until?: string | null
          vat_amount?: number | null
          vat_rate?: number
          withdrawn_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_revisions_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "quotation_revisions_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_revisions_internal_price_id_fkey"
            columns: ["internal_price_id"]
            isOneToOne: false
            referencedRelation: "commercial_review_queue"
            referencedColumns: ["internal_price_id"]
          },
          {
            foreignKeyName: "quotation_revisions_internal_price_id_fkey"
            columns: ["internal_price_id"]
            isOneToOne: false
            referencedRelation: "internal_price_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_revisions_internal_price_id_fkey"
            columns: ["internal_price_id"]
            isOneToOne: false
            referencedRelation: "internal_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_revisions_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_revisions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "quotation_current_revision"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "quotation_revisions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "quotation_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_updates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          next_action: string | null
          next_action_due: string | null
          opportunity_id: string | null
          quotation_id: string | null
          source_batch_id: string | null
          source_row_id: string | null
          status_after: string | null
          status_before: string | null
          summary: string
          update_date: string
          update_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_action?: string | null
          next_action_due?: string | null
          opportunity_id?: string | null
          quotation_id?: string | null
          source_batch_id?: string | null
          source_row_id?: string | null
          status_after?: string | null
          status_before?: string | null
          summary: string
          update_date: string
          update_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          next_action?: string | null
          next_action_due?: string | null
          opportunity_id?: string | null
          quotation_id?: string | null
          source_batch_id?: string | null
          source_row_id?: string | null
          status_after?: string | null
          status_before?: string | null
          summary?: string
          update_date?: string
          update_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotation_updates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_updates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_updates_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_updates_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_updates_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          boq_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          extra_data: Json | null
          id: string
          issued_date: string | null
          last_follow_up_at: string | null
          notes: string | null
          owner_id: string | null
          pdf_url: string | null
          quote_number: string
          related_opportunity_id: string
          status: Database["public"]["Enums"]["quotation_status"]
          updated_at: string
          valid_until: string | null
          value: number | null
          version: number
          win_loss_reason: string | null
        }
        Insert: {
          boq_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          extra_data?: Json | null
          id?: string
          issued_date?: string | null
          last_follow_up_at?: string | null
          notes?: string | null
          owner_id?: string | null
          pdf_url?: string | null
          quote_number: string
          related_opportunity_id: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
          valid_until?: string | null
          value?: number | null
          version?: number
          win_loss_reason?: string | null
        }
        Update: {
          boq_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          extra_data?: Json | null
          id?: string
          issued_date?: string | null
          last_follow_up_at?: string | null
          notes?: string | null
          owner_id?: string | null
          pdf_url?: string | null
          quote_number?: string
          related_opportunity_id?: string
          status?: Database["public"]["Enums"]["quotation_status"]
          updated_at?: string
          valid_until?: string | null
          value?: number | null
          version?: number
          win_loss_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_cost_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "quotations_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_sales_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "quotations_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          agent_module: string
          confidence_score: number | null
          created_at: string
          created_by: string | null
          data_sources: string | null
          evidence: string | null
          id: string
          reason: string | null
          recommendation: string
          related_company_id: string | null
          related_lead_id: string | null
          related_opportunity_id: string | null
          required_approval_type: string | null
          risk_notes: string | null
          status: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id: string | null
          updated_at: string
        }
        Insert: {
          agent_module: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_sources?: string | null
          evidence?: string | null
          id?: string
          reason?: string | null
          recommendation: string
          related_company_id?: string | null
          related_lead_id?: string | null
          related_opportunity_id?: string | null
          required_approval_type?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_module?: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          data_sources?: string | null
          evidence?: string | null
          id?: string
          reason?: string | null
          recommendation?: string
          related_company_id?: string | null
          related_lead_id?: string | null
          related_opportunity_id?: string | null
          required_approval_type?: string | null
          risk_notes?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          suggested_owner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_related_company_id_fkey"
            columns: ["related_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_lead_id_fkey"
            columns: ["related_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_review_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_lead_id_fkey"
            columns: ["related_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_projects: {
        Row: {
          challenges: string | null
          city: string | null
          client_or_contractor: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          images: string | null
          materials: string | null
          name: string
          phc_scope: string | null
          project_type: string | null
          project_value: number | null
          requires_approval_to_share: boolean
          sector: string | null
          shareable_with_client: boolean
          sign_types: string | null
          solutions: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          challenges?: string | null
          city?: string | null
          client_or_contractor?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          images?: string | null
          materials?: string | null
          name: string
          phc_scope?: string | null
          project_type?: string | null
          project_value?: number | null
          requires_approval_to_share?: boolean
          sector?: string | null
          shareable_with_client?: boolean
          sign_types?: string | null
          solutions?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          challenges?: string | null
          city?: string | null
          client_or_contractor?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          images?: string | null
          materials?: string | null
          name?: string
          phc_scope?: string | null
          project_type?: string | null
          project_value?: number | null
          requires_approval_to_share?: boolean
          sector?: string | null
          shareable_with_client?: boolean
          sign_types?: string | null
          solutions?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      rfqs: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          below_300k_exception_approval_id: string | null
          city: string | null
          classification: string | null
          classification_other: string | null
          company_id: string | null
          contact_id: string | null
          contact_plan_ready: boolean
          conversion_reason: string | null
          created_at: string
          created_by: string | null
          document_storage_path: string | null
          document_url: string | null
          estimated_signage_value: number | null
          estimated_value: number | null
          extra_data: Json | null
          id: string
          main_contractor_confirmed: boolean
          notes: string | null
          opportunity_id: string | null
          package_not_closed: boolean
          project_id: string | null
          project_stage_suitable: boolean
          received_date: string
          response_due_date: string | null
          rfq_number: string | null
          sales_owner_id: string | null
          signage_package_confidence: Database["public"]["Enums"]["confidence_level"]
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source_type: string | null
          status: Database["public"]["Enums"]["rfq_status"]
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          below_300k_exception_approval_id?: string | null
          city?: string | null
          classification?: string | null
          classification_other?: string | null
          company_id?: string | null
          contact_id?: string | null
          contact_plan_ready?: boolean
          conversion_reason?: string | null
          created_at?: string
          created_by?: string | null
          document_storage_path?: string | null
          document_url?: string | null
          estimated_signage_value?: number | null
          estimated_value?: number | null
          extra_data?: Json | null
          id?: string
          main_contractor_confirmed?: boolean
          notes?: string | null
          opportunity_id?: string | null
          package_not_closed?: boolean
          project_id?: string | null
          project_stage_suitable?: boolean
          received_date?: string
          response_due_date?: string | null
          rfq_number?: string | null
          sales_owner_id?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_type?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          below_300k_exception_approval_id?: string | null
          city?: string | null
          classification?: string | null
          classification_other?: string | null
          company_id?: string | null
          contact_id?: string | null
          contact_plan_ready?: boolean
          conversion_reason?: string | null
          created_at?: string
          created_by?: string | null
          document_storage_path?: string | null
          document_url?: string | null
          estimated_signage_value?: number | null
          estimated_value?: number | null
          extra_data?: Json | null
          id?: string
          main_contractor_confirmed?: boolean
          notes?: string | null
          opportunity_id?: string | null
          package_not_closed?: boolean
          project_id?: string | null
          project_stage_suitable?: boolean
          received_date?: string
          response_due_date?: string | null
          rfq_number?: string | null
          sales_owner_id?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_type?: string | null
          status?: Database["public"]["Enums"]["rfq_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_below_300k_exception_approval_id_fkey"
            columns: ["below_300k_exception_approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_actuals_monthly: {
        Row: {
          actual_value: number
          created_at: string
          created_by: string | null
          currency: string
          id: string
          is_legacy_aggregate: boolean
          metric_type: string
          month: number
          notes: string | null
          owner_id: string | null
          source_batch_id: string | null
          source_profile_id: string | null
          source_row_id: string | null
          team_label: string | null
          updated_at: string
          year: number
        }
        Insert: {
          actual_value?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_legacy_aggregate?: boolean
          metric_type: string
          month: number
          notes?: string | null
          owner_id?: string | null
          source_batch_id?: string | null
          source_profile_id?: string | null
          source_row_id?: string | null
          team_label?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          actual_value?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_legacy_aggregate?: boolean
          metric_type?: string
          month?: number
          notes?: string | null
          owner_id?: string | null
          source_batch_id?: string | null
          source_profile_id?: string | null
          source_row_id?: string | null
          team_label?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_actuals_monthly_source_batch_id_fkey"
            columns: ["source_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_actuals_monthly_source_profile_id_fkey"
            columns: ["source_profile_id"]
            isOneToOne: false
            referencedRelation: "import_source_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_actuals_monthly_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          activity_target: number
          conversion_target: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          period_start: string
          period_type: Database["public"]["Enums"]["target_period"]
          pipeline_target: number
          quotation_target: number
          reactivation_target: number
          sales_target: number
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_target?: number
          conversion_target?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_start: string
          period_type?: Database["public"]["Enums"]["target_period"]
          pipeline_target?: number
          quotation_target?: number
          reactivation_target?: number
          sales_target?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_target?: number
          conversion_target?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_start?: string
          period_type?: Database["public"]["Enums"]["target_period"]
          pipeline_target?: number
          quotation_target?: number
          reactivation_target?: number
          sales_target?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sla_policies: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          escalate_to_role: Database["public"]["Enums"]["app_role"] | null
          id: string
          rationale: string | null
          subject: Database["public"]["Enums"]["sla_subject"]
          threshold_days: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          escalate_to_role?: Database["public"]["Enums"]["app_role"] | null
          id?: string
          rationale?: string | null
          subject: Database["public"]["Enums"]["sla_subject"]
          threshold_days: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          escalate_to_role?: Database["public"]["Enums"]["app_role"] | null
          id?: string
          rationale?: string | null
          subject?: Database["public"]["Enums"]["sla_subject"]
          threshold_days?: number
        }
        Relationships: []
      }
      snapshot_versions: {
        Row: {
          agent_name: string
          generated_at: string
          id: string
          records_summary: Json | null
          snapshot_path: string | null
          status: string
          trigger_type: string | null
        }
        Insert: {
          agent_name: string
          generated_at?: string
          id?: string
          records_summary?: Json | null
          snapshot_path?: string | null
          status?: string
          trigger_type?: string | null
        }
        Update: {
          agent_name?: string
          generated_at?: string
          id?: string
          records_summary?: Json | null
          snapshot_path?: string | null
          status?: string
          trigger_type?: string | null
        }
        Relationships: []
      }
      source_registry: {
        Row: {
          approved_for_agent_use: boolean
          freshness_status: string | null
          id: string
          last_reviewed_at: string | null
          owner: string | null
          source_type: string
          vault_path: string
        }
        Insert: {
          approved_for_agent_use?: boolean
          freshness_status?: string | null
          id?: string
          last_reviewed_at?: string | null
          owner?: string | null
          source_type: string
          vault_path: string
        }
        Update: {
          approved_for_agent_use?: boolean
          freshness_status?: string | null
          id?: string
          last_reviewed_at?: string | null
          owner?: string | null
          source_type?: string
          vault_path?: string
        }
        Relationships: []
      }
      stage_transition_history: {
        Row: {
          actor_id: string | null
          approval_id: string | null
          created_at: string
          evidence: string | null
          from_stage: string | null
          id: string
          notes: string | null
          record_id: string
          record_type: string
          to_stage: string
        }
        Insert: {
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          evidence?: string | null
          from_stage?: string | null
          id?: string
          notes?: string | null
          record_id: string
          record_type: string
          to_stage: string
        }
        Update: {
          actor_id?: string | null
          approval_id?: string | null
          created_at?: string
          evidence?: string | null
          from_stage?: string | null
          id?: string
          notes?: string | null
          record_id?: string
          record_type?: string
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_transition_history_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholders: {
        Row: {
          contact_confidence: Database["public"]["Enums"]["confidence_level"]
          contact_order: number | null
          created_at: string
          email: string | null
          id: string
          last_interaction_at: string | null
          name: string
          notes: string | null
          opportunity_id: string
          organization: string | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          contact_confidence?: Database["public"]["Enums"]["confidence_level"]
          contact_order?: number | null
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          name: string
          notes?: string | null
          opportunity_id: string
          organization?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          contact_confidence?: Database["public"]["Enums"]["confidence_level"]
          contact_order?: number | null
          created_at?: string
          email?: string | null
          id?: string
          last_interaction_at?: string | null
          name?: string
          notes?: string | null
          opportunity_id?: string
          organization?: string | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholders_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholders_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_quote_lines: {
        Row: {
          alternate_spec: string | null
          boq_line_id: string
          created_at: string
          id: string
          is_selected: boolean
          lead_time_days: number | null
          line_cost: number | null
          quantity: number | null
          selected_at: string | null
          selected_by: string | null
          selection_note: string | null
          supplier_quote_id: string
          unit_cost: number | null
        }
        Insert: {
          alternate_spec?: string | null
          boq_line_id: string
          created_at?: string
          id?: string
          is_selected?: boolean
          lead_time_days?: number | null
          line_cost?: number | null
          quantity?: number | null
          selected_at?: string | null
          selected_by?: string | null
          selection_note?: string | null
          supplier_quote_id: string
          unit_cost?: number | null
        }
        Update: {
          alternate_spec?: string | null
          boq_line_id?: string
          created_at?: string
          id?: string
          is_selected?: boolean
          lead_time_days?: number | null
          line_cost?: number | null
          quantity?: number | null
          selected_at?: string | null
          selected_by?: string | null
          selection_note?: string | null
          supplier_quote_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_line_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_supplier_quote_id_fkey"
            columns: ["supplier_quote_id"]
            isOneToOne: false
            referencedRelation: "supplier_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_quotes: {
        Row: {
          boq_revision_id: string
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          currency: string
          frozen_at: string | null
          frozen_by: string | null
          id: string
          is_current: boolean
          lead_time_days: number | null
          notes: string | null
          payment_terms: string | null
          response_received_at: string | null
          revision_number: number
          rfq_reference: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["supplier_quote_status"]
          supersedes_id: string | null
          updated_at: string
          valid_until: string | null
          vendor_id: string
        }
        Insert: {
          boq_revision_id: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_current?: boolean
          lead_time_days?: number | null
          notes?: string | null
          payment_terms?: string | null
          response_received_at?: string | null
          revision_number?: number
          rfq_reference?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["supplier_quote_status"]
          supersedes_id?: string | null
          updated_at?: string
          valid_until?: string | null
          vendor_id: string
        }
        Update: {
          boq_revision_id?: string
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          is_current?: boolean
          lead_time_days?: number | null
          notes?: string | null
          payment_terms?: string | null
          response_received_at?: string | null
          revision_number?: number
          rfq_reference?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["supplier_quote_status"]
          supersedes_id?: string | null
          updated_at?: string
          valid_until?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_quotes_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "supplier_quotes_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "supplier_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_full"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_tier"]
          related_opportunity_id?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_contractors: {
        Row: {
          contractor_company_id: string | null
          contractor_status: string | null
          created_at: string
          created_by: string | null
          id: string
          last_verified_at: string | null
          notes: string | null
          source: string | null
          tender_id: string
          win_likelihood: Database["public"]["Enums"]["confidence_level"] | null
        }
        Insert: {
          contractor_company_id?: string | null
          contractor_status?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_verified_at?: string | null
          notes?: string | null
          source?: string | null
          tender_id: string
          win_likelihood?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Update: {
          contractor_company_id?: string | null
          contractor_status?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_verified_at?: string | null
          notes?: string | null
          source?: string | null
          tender_id?: string
          win_likelihood?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "tender_contractors_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_contractors_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          award_evidence: string | null
          below_300k_exception_approval_id: string | null
          contact_plan_ready: boolean
          contractor_award_date: string | null
          contractor_award_evidence: string | null
          conversion_reason: string | null
          converted_opportunity_id: string | null
          created_at: string
          created_by: string | null
          estimated_project_value: number | null
          estimated_signage_value: number | null
          expected_award_date: string | null
          extra_data: Json | null
          id: string
          is_watchlisted: boolean
          main_contractor_confirmed: boolean
          main_contractor_id: string | null
          next_follow_up_date: string | null
          package_not_closed: boolean
          project_id: string | null
          project_stage_suitable: boolean
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string | null
          tender_name: string
          tender_owner_id: string | null
          tender_priority_classification:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage: Database["public"]["Enums"]["tender_stage"]
          tender_subtype: string | null
          updated_at: string
          winning_contractor_id: string | null
          winning_contractor_name: string | null
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          award_evidence?: string | null
          below_300k_exception_approval_id?: string | null
          contact_plan_ready?: boolean
          contractor_award_date?: string | null
          contractor_award_evidence?: string | null
          conversion_reason?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_project_value?: number | null
          estimated_signage_value?: number | null
          expected_award_date?: string | null
          extra_data?: Json | null
          id?: string
          is_watchlisted?: boolean
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          next_follow_up_date?: string | null
          package_not_closed?: boolean
          project_id?: string | null
          project_stage_suitable?: boolean
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          tender_name: string
          tender_owner_id?: string | null
          tender_priority_classification?:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage?: Database["public"]["Enums"]["tender_stage"]
          tender_subtype?: string | null
          updated_at?: string
          winning_contractor_id?: string | null
          winning_contractor_name?: string | null
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          award_evidence?: string | null
          below_300k_exception_approval_id?: string | null
          contact_plan_ready?: boolean
          contractor_award_date?: string | null
          contractor_award_evidence?: string | null
          conversion_reason?: string | null
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_project_value?: number | null
          estimated_signage_value?: number | null
          expected_award_date?: string | null
          extra_data?: Json | null
          id?: string
          is_watchlisted?: boolean
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          next_follow_up_date?: string | null
          package_not_closed?: boolean
          project_id?: string | null
          project_stage_suitable?: boolean
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          tender_name?: string
          tender_owner_id?: string | null
          tender_priority_classification?:
            | Database["public"]["Enums"]["priority_tier"]
            | null
          tender_stage?: Database["public"]["Enums"]["tender_stage"]
          tender_subtype?: string | null
          updated_at?: string
          winning_contractor_id?: string | null
          winning_contractor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenders_below_300k_exception_approval_id_fkey"
            columns: ["below_300k_exception_approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_converted_opportunity_id_fkey"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenders_winning_contractor_id_fkey"
            columns: ["winning_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          lead_time: string | null
          materials: string | null
          name: string
          name_normalized: string | null
          portal_url: string | null
          previous_projects: string | null
          qualification_files: string | null
          quality_level: string | null
          scope: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_time?: string | null
          materials?: string | null
          name: string
          name_normalized?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_time?: string | null
          materials?: string | null
          name?: string
          name_normalized?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vendors_private: {
        Row: {
          id: string
          internal_notes: string | null
          internal_rating: number | null
          reference_prices: string | null
          vendor_id: string
        }
        Insert: {
          id?: string
          internal_notes?: string | null
          internal_rating?: number | null
          reference_prices?: string | null
          vendor_id: string
        }
        Update: {
          id?: string
          internal_notes?: string | null
          internal_rating?: number | null
          reference_prices?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_private_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_private_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: true
            referencedRelation: "vendors_full"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ai_advice_queue: {
        Row: {
          agent_key: string | null
          confidence: number | null
          created_at: string | null
          days_open: number | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          missing_data: string[] | null
          rationale: string | null
          recommendation: string | null
          severity: string | null
          status: string | null
          suggested_action: string | null
          title: string | null
        }
        Insert: {
          agent_key?: string | null
          confidence?: number | null
          created_at?: string | null
          days_open?: never
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          missing_data?: string[] | null
          rationale?: string | null
          recommendation?: string | null
          severity?: string | null
          status?: string | null
          suggested_action?: string | null
          title?: string | null
        }
        Update: {
          agent_key?: string | null
          confidence?: number | null
          created_at?: string | null
          days_open?: never
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          missing_data?: string[] | null
          rationale?: string | null
          recommendation?: string | null
          severity?: string | null
          status?: string | null
          suggested_action?: string | null
          title?: string | null
        }
        Relationships: []
      }
      analytics_scope_opportunities: {
        Row: {
          action_priority: Database["public"]["Enums"]["priority_tier"] | null
          action_required: boolean | null
          agent_reasoning: string | null
          agent_recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client: string | null
          commercial_handoff_at: string | null
          commercial_handoff_by: string | null
          commercial_handoff_note: string | null
          commercial_handoff_status: string | null
          company_id: string | null
          contract_received_date: string | null
          contract_reference_number: string | null
          contract_signed_date: string | null
          contract_value: number | null
          contractor_decision_maker: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          estimated_value_max: number | null
          estimated_value_min: number | null
          evidence_count: number | null
          exclusion_reason:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date: string | null
          extra_data: Json | null
          flow_type: Database["public"]["Enums"]["flow_type"] | null
          handover_status: Database["public"]["Enums"]["handover_status"] | null
          hold_reason: string | null
          hold_review_date: string | null
          human_probability_at: string | null
          human_probability_by: string | null
          human_probability_reason: string | null
          human_win_probability: number | null
          id: string | null
          last_activity_at: string | null
          location: string | null
          loss_notes: string | null
          loss_reason: string | null
          lost_at: string | null
          lost_at_stage: string | null
          lost_to_competitor: string | null
          main_contractor: string | null
          main_contractor_confirmed: boolean | null
          main_contractor_id: string | null
          management_review_reason: string | null
          next_action: string | null
          next_action_due: string | null
          owner_id: string | null
          package_budget_confirmed: boolean | null
          person_in_charge_id: string | null
          person_in_charge_note: string | null
          pipeline_step: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status: string | null
          project_id: string | null
          project_name: string | null
          project_stage: Database["public"]["Enums"]["project_stage"] | null
          quotation_value: number | null
          sales_stage: Database["public"]["Enums"]["sales_stage"] | null
          score: number | null
          score_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override: boolean | null
          score_missing_data: string[] | null
          score_override_reason: string | null
          score_reasons: string[] | null
          score_recommended_action: string | null
          score_risk_flags: string[] | null
          score_tier:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at: string | null
          scored_by: string | null
          sector: string | null
          signage_package_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          signage_package_status:
            | Database["public"]["Enums"]["signage_package_status"]
            | null
          source_confidence:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source_tender_id: string | null
          stage: Database["public"]["Enums"]["opportunity_stage"] | null
          strategic_value: string | null
          technical_notes: string | null
          tier: Database["public"]["Enums"]["priority_tier"] | null
          updated_at: string | null
          verbal_award_contact_name: string | null
          verbal_award_contact_title: string | null
          verbal_award_date: string | null
          verbal_award_evidence: string | null
          verbal_award_method: string | null
          win_confidence: Database["public"]["Enums"]["win_confidence"] | null
          won_at: string | null
        }
        Insert: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean | null
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          commercial_handoff_at?: string | null
          commercial_handoff_by?: string | null
          commercial_handoff_note?: string | null
          commercial_handoff_status?: string | null
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_signed_date?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number | null
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          extra_data?: Json | null
          flow_type?: Database["public"]["Enums"]["flow_type"] | null
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          human_probability_at?: string | null
          human_probability_by?: string | null
          human_probability_reason?: string | null
          human_win_probability?: number | null
          id?: string | null
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          lost_at_stage?: string | null
          lost_to_competitor?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean | null
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean | null
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"] | null
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          score?: number | null
          score_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override?: boolean | null
          score_missing_data?: string[] | null
          score_override_reason?: string | null
          score_reasons?: string[] | null
          score_recommended_action?: string | null
          score_risk_flags?: string[] | null
          score_tier?:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at?: string | null
          scored_by?: string | null
          sector?: string | null
          signage_package_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          signage_package_status?:
            | Database["public"]["Enums"]["signage_package_status"]
            | null
          source_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source_tender_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          strategic_value?: string | null
          technical_notes?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"] | null
          updated_at?: string | null
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
          won_at?: string | null
        }
        Update: {
          action_priority?: Database["public"]["Enums"]["priority_tier"] | null
          action_required?: boolean | null
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          commercial_handoff_at?: string | null
          commercial_handoff_by?: string | null
          commercial_handoff_note?: string | null
          commercial_handoff_status?: string | null
          company_id?: string | null
          contract_received_date?: string | null
          contract_reference_number?: string | null
          contract_signed_date?: string | null
          contract_value?: number | null
          contractor_decision_maker?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          estimated_value_max?: number | null
          estimated_value_min?: number | null
          evidence_count?: number | null
          exclusion_reason?:
            | Database["public"]["Enums"]["exclusion_reason"]
            | null
          expected_contract_date?: string | null
          extra_data?: Json | null
          flow_type?: Database["public"]["Enums"]["flow_type"] | null
          handover_status?:
            | Database["public"]["Enums"]["handover_status"]
            | null
          hold_reason?: string | null
          hold_review_date?: string | null
          human_probability_at?: string | null
          human_probability_by?: string | null
          human_probability_reason?: string | null
          human_win_probability?: number | null
          id?: string | null
          last_activity_at?: string | null
          location?: string | null
          loss_notes?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          lost_at_stage?: string | null
          lost_to_competitor?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean | null
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean | null
          person_in_charge_id?: string | null
          person_in_charge_note?: string | null
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"] | null
          quotation_value?: number | null
          sales_stage?: Database["public"]["Enums"]["sales_stage"] | null
          score?: number | null
          score_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          score_manual_override?: boolean | null
          score_missing_data?: string[] | null
          score_override_reason?: string | null
          score_reasons?: string[] | null
          score_recommended_action?: string | null
          score_risk_flags?: string[] | null
          score_tier?:
            | Database["public"]["Enums"]["opportunity_score_tier"]
            | null
          scored_at?: string | null
          scored_by?: string | null
          sector?: string | null
          signage_package_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          signage_package_status?:
            | Database["public"]["Enums"]["signage_package_status"]
            | null
          source_confidence?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source_tender_id?: string | null
          stage?: Database["public"]["Enums"]["opportunity_stage"] | null
          strategic_value?: string | null
          technical_notes?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"] | null
          updated_at?: string | null
          verbal_award_contact_name?: string | null
          verbal_award_contact_title?: string | null
          verbal_award_date?: string | null
          verbal_award_evidence?: string | null
          verbal_award_method?: string | null
          win_confidence?: Database["public"]["Enums"]["win_confidence"] | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_main_contractor_id_fkey"
            columns: ["main_contractor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_source_tender_id_fkey"
            columns: ["source_tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_health: {
        Row: {
          hours_since_last: number | null
          last_error: string | null
          last_finished_at: string | null
          last_started_at: string | null
          looks_stalled: boolean | null
          runs_with_errors: number | null
          trigger: string | null
        }
        Relationships: []
      }
      boq_cost_totals: {
        Row: {
          boq_id: string | null
          cost_total: number | null
          lines_cost_total: number | null
          lines_selling_total: number | null
          related_opportunity_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_item_costs: {
        Row: {
          boq_id: string | null
          cost_estimate: number | null
          id: string | null
          margin_pct: number | null
          margin_value: number | null
          quantity: number | null
          selling_price: number | null
          sign_type: string | null
          sort_order: number | null
          unit_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_cost_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_sales_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_items_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_line_costs: {
        Row: {
          id: string | null
          line_number: number | null
          line_total: number | null
          margin_pct: number | null
          margin_value: number | null
          quantity: number | null
          revision_id: string | null
          selling_price: number | null
          sign_type: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          id?: string | null
          line_number?: number | null
          line_total?: number | null
          margin_pct?: never
          margin_value?: never
          quantity?: number | null
          revision_id?: string | null
          selling_price?: number | null
          sign_type?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          id?: string | null
          line_number?: number | null
          line_total?: number | null
          margin_pct?: never
          margin_value?: never
          quantity?: number | null
          revision_id?: string | null
          selling_price?: number | null
          sign_type?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_revision_sales_totals: {
        Row: {
          boq_id: string | null
          frozen_at: string | null
          is_current: boolean | null
          line_count: number | null
          revision_id: string | null
          revision_number: number | null
          selling_total: number | null
          source_type: Database["public"]["Enums"]["boq_source_type"] | null
          status: Database["public"]["Enums"]["boq_revision_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_cost_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boq_sales_totals"
            referencedColumns: ["boq_id"]
          },
          {
            foreignKeyName: "boq_revisions_boq_id_fkey"
            columns: ["boq_id"]
            isOneToOne: false
            referencedRelation: "boqs"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_sales_totals: {
        Row: {
          boq_id: string | null
          currency: string | null
          line_count: number | null
          related_opportunity_id: string | null
          selling_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_review_queue: {
        Row: {
          awaiting: string | null
          boq_revision_id: string | null
          commercial_reviewed_at: string | null
          days_waiting: number | null
          estimation_id: string | null
          finance_reviewed_at: string | null
          internal_price_id: string | null
          proposed_at: string | null
          related_opportunity_id: string | null
          status: Database["public"]["Enums"]["internal_price_status"] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boqs_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimation_cost_reconciliation"
            referencedColumns: ["estimation_id"]
          },
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_log: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          kind: string | null
          occurred_at: string | null
          opportunity_id: string | null
          owner_id: string | null
          source: string | null
          state: string | null
          summary: string | null
        }
        Relationships: []
      }
      conversion_summary: {
        Row: {
          avg_days_to_win: number | null
          lost: number | null
          open_deals: number | null
          owner_id: string | null
          total_deals: number | null
          win_rate_pct: number | null
          won: number | null
          won_value: number | null
        }
        Relationships: []
      }
      document_backfill_status: {
        Row: {
          active_links: number | null
          derived_path: string | null
          now_registered: boolean | null
          outcome: string | null
          raw_value: string | null
          reason: string | null
          record_id: string | null
          reported_at: string | null
          source_column: string | null
          source_table: string | null
        }
        Relationships: []
      }
      estimation_cost_reconciliation: {
        Row: {
          boq_revision_id: string | null
          cost_basis: number | null
          estimation_id: string | null
          installation_cost: number | null
          overhead_pct: number | null
          selected_lines: number | null
          supplier_cost: number | null
          typed_cost_total: number | null
          typed_vs_supplier_pct: number | null
          wastage_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_promotion_queue: {
        Row: {
          amount_excl_vat: number | null
          archive_amount: number | null
          client_name_raw: string | null
          company_id: string | null
          missing_mappings: string[] | null
          owner_label: string | null
          owner_prefix: string | null
          owner_user_id: string | null
          project_name: string | null
          project_name_raw: string | null
          promoted_at: string | null
          promoted_opportunity_id: string | null
          request_id: string | null
          requested_at: string | null
          reviewed_at: string | null
          row_id: string | null
          sales_code_raw: string | null
          status:
            | Database["public"]["Enums"]["historical_promotion_status"]
            | null
          status_canonical: string | null
          status_raw: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_promotion_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_promoted_opportunity_id_fkey"
            columns: ["promoted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_promoted_opportunity_id_fkey"
            columns: ["promoted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_promotion_requests_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_quality: {
        Row: {
          amounts_absent: number | null
          amounts_unparsed: number | null
          batch_id: string | null
          codes_placeholder: number | null
          codes_unparsed: number | null
          companies_unmatched: number | null
          owners_legacy_only: number | null
          revisions: number | null
          route_unknown: number | null
          statuses_needing_decision: number | null
          submission_dates_missing: number | null
          total_amount_excl_vat: number | null
          total_rows: number | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_sales_mapped_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_sales_search: {
        Row: {
          amount: number | null
          base_code: string | null
          batch_id: string | null
          client: string | null
          company_id: string | null
          company_matched: boolean | null
          contact_name: string | null
          currency: string | null
          date_received: string | null
          date_submitted: string | null
          email_subject: string | null
          location: string | null
          owner: string | null
          owner_prefix: string | null
          owner_user_id: string | null
          project: string | null
          revision_no: number | null
          route: string | null
          row_id: string | null
          row_number: number | null
          sales_code: string | null
          search_text: string | null
          status: string | null
          status_canonical: string | null
          update_log: string | null
          variant: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_sales_mapped_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_sales_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_sales_mapped_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_sales_mapped_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: true
            referencedRelation: "historical_sales_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_price_summary: {
        Row: {
          boq_revision_id: string | null
          commercial_reviewed_at: string | null
          commercial_reviewed_by: string | null
          cost_total: number | null
          estimation_id: string | null
          finance_reviewed_at: string | null
          finance_reviewed_by: string | null
          gm_decided_at: string | null
          gm_decided_by: string | null
          id: string | null
          installation_cost: number | null
          margin_percentage: number | null
          margin_value: number | null
          overhead_pct: number | null
          proposed_at: string | null
          proposed_by: string | null
          proposed_price: number | null
          return_reason: string | null
          status: Database["public"]["Enums"]["internal_price_status"] | null
          wastage_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "estimations_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimation_cost_reconciliation"
            referencedColumns: ["estimation_id"]
          },
          {
            foreignKeyName: "internal_prices_estimation_id_fkey"
            columns: ["estimation_id"]
            isOneToOne: false
            referencedRelation: "estimations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_duplicate_candidates: {
        Row: {
          already_linked: boolean | null
          dedupe_key: string | null
          lead_count: number | null
          lead_ids: string[] | null
          project_names: string[] | null
          sources: string[] | null
        }
        Relationships: []
      }
      lead_review_queue: {
        Row: {
          created_at: string | null
          days_waiting: number | null
          estimated_value: number | null
          has_duplicate_candidates: boolean | null
          id: string | null
          is_marked_duplicate: boolean | null
          lead_score: number | null
          lead_stage: Database["public"]["Enums"]["lead_stage"] | null
          location: string | null
          main_contractor_guess: string | null
          owner_id: string | null
          project_name: string | null
          reviewed: boolean | null
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string | null
          source_approved: boolean | null
          source_url: string | null
        }
        Insert: {
          created_at?: string | null
          days_waiting?: never
          estimated_value?: number | null
          has_duplicate_candidates?: never
          id?: string | null
          is_marked_duplicate?: never
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"] | null
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name?: string | null
          reviewed?: never
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          source_approved?: never
          source_url?: string | null
        }
        Update: {
          created_at?: string | null
          days_waiting?: never
          estimated_value?: number | null
          has_duplicate_candidates?: never
          id?: string | null
          is_marked_duplicate?: never
          lead_score?: number | null
          lead_stage?: Database["public"]["Enums"]["lead_stage"] | null
          location?: string | null
          main_contractor_guess?: string | null
          owner_id?: string | null
          project_name?: string | null
          reviewed?: never
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string | null
          source_approved?: never
          source_url?: string | null
        }
        Relationships: []
      }
      loss_analysis: {
        Row: {
          deals: number | null
          loss_reason: string | null
          lost_at_stage: string | null
          lost_to_a_named_competitor: number | null
          lost_value: number | null
        }
        Relationships: []
      }
      opportunity_next_action: {
        Row: {
          days_until_due: number | null
          description: string | null
          due_date: string | null
          is_overdue: boolean | null
          opportunity_id: string | null
          owner_id: string | null
          source: string | null
          source_id: string | null
        }
        Relationships: []
      }
      overdue_commitments: {
        Row: {
          company_id: string | null
          days_overdue: number | null
          description: string | null
          direction: Database["public"]["Enums"]["commitment_direction"] | null
          due_date: string | null
          id: string | null
          opportunity_id: string | null
          owner_id: string | null
        }
        Insert: {
          company_id?: string | null
          days_overdue?: never
          description?: string | null
          direction?: Database["public"]["Enums"]["commitment_direction"] | null
          due_date?: string | null
          id?: string | null
          opportunity_id?: string | null
          owner_id?: string | null
        }
        Update: {
          company_id?: string | null
          days_overdue?: never
          description?: string | null
          direction?: Database["public"]["Enums"]["commitment_direction"] | null
          due_date?: string | null
          id?: string | null
          opportunity_id?: string | null
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commitments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_by_stage: {
        Row: {
          average_deal: number | null
          deals: number | null
          my_deals: number | null
          pipeline_value: number | null
          sales_stage: Database["public"]["Enums"]["sales_stage"] | null
          stalled: number | null
        }
        Relationships: []
      }
      quotation_current_revision: {
        Row: {
          approved_at: string | null
          currency: string | null
          issued_at: string | null
          quotation_id: string | null
          quote_number: string | null
          related_opportunity_id: string | null
          revision_id: string | null
          revision_number: number | null
          status:
            | Database["public"]["Enums"]["quotation_revision_status"]
            | null
          submitted_at: string | null
          subtotal_excl_vat: number | null
          total_incl_vat: number | null
          valid_until: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_revisions_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "analytics_scope_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_forecast: {
        Row: {
          deals: number | null
          forecast_month: string | null
          gross_value: number | null
          owner_id: string | null
          undated_deals: number | null
          weighted_value: number | null
        }
        Relationships: []
      }
      sla_breaches: {
        Row: {
          days_overdue: number | null
          detail: string | null
          opportunity_id: string | null
          owner_id: string | null
          record_id: string | null
          subject: Database["public"]["Enums"]["sla_subject"] | null
          threshold_days: number | null
        }
        Relationships: []
      }
      supplier_comparison: {
        Row: {
          average_unit_cost: number | null
          boq_line_id: string | null
          has_selection: boolean | null
          highest_unit_cost: number | null
          lowest_unit_cost: number | null
          quotes_received: number | null
          revision_id: string | null
          selected_unit_cost: number | null
          selected_vendor: string | null
          sign_type: string | null
          spread: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "boq_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_line_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_quote_costs: {
        Row: {
          alternate_spec: string | null
          boq_line_id: string | null
          boq_revision_id: string | null
          currency: string | null
          id: string | null
          is_current: boolean | null
          is_selected: boolean | null
          lead_time_days: number | null
          line_cost: number | null
          quantity: number | null
          revision_number: number | null
          selected_at: string | null
          selected_by: string | null
          selection_note: string | null
          status: Database["public"]["Enums"]["supplier_quote_status"] | null
          supplier_quote_id: string | null
          unit_cost: number | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_line_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "boq_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quote_lines_supplier_quote_id_fkey"
            columns: ["supplier_quote_id"]
            isOneToOne: false
            referencedRelation: "supplier_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revision_sales_totals"
            referencedColumns: ["revision_id"]
          },
          {
            foreignKeyName: "supplier_quotes_boq_revision_id_fkey"
            columns: ["boq_revision_id"]
            isOneToOne: false
            referencedRelation: "boq_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_quotes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors_full"
            referencedColumns: ["id"]
          },
        ]
      }
      target_vs_actual: {
        Row: {
          attainment_pct: number | null
          period_end: string | null
          period_start: string | null
          period_type: Database["public"]["Enums"]["target_period"] | null
          pipeline_target: number | null
          quotation_target: number | null
          sales_target: number | null
          target_id: string | null
          user_id: string | null
          won_deals: number | null
          won_value: number | null
        }
        Relationships: []
      }
      team_performance: {
        Row: {
          last_activity_at: string | null
          lost_deals: number | null
          open_deals: number | null
          open_value: number | null
          owner_id: string | null
          stalled_deals: number | null
          won_deals: number | null
          won_value: number | null
        }
        Relationships: []
      }
      vendor_duplicate_candidates: {
        Row: {
          name_normalized: string | null
          vendor_count: number | null
          vendor_ids: string[] | null
          vendor_names: string[] | null
        }
        Relationships: []
      }
      vendors_full: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          internal_notes: string | null
          internal_rating: number | null
          lead_time: string | null
          materials: string | null
          name: string | null
          portal_url: string | null
          previous_projects: string | null
          quality_level: string | null
          reference_prices: string | null
          scope: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_output_entity_still_owned: {
        Args: { _entity_id: string; _entity_type: string; _user_id: string }
        Returns: boolean
      }
      boq_revision_is_frozen: {
        Args: { _revision_id: string }
        Returns: boolean
      }
      can_access_import_batch: {
        Args: { _batch_uuid: string }
        Returns: boolean
      }
      can_approve_final_price: { Args: { _user_id: string }; Returns: boolean }
      can_approve_historical_promotion: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_edit_rfq_number: { Args: { _user_id: string }; Returns: boolean }
      can_edit_total_value: { Args: { _user_id: string }; Returns: boolean }
      can_read_activity: {
        Args: {
          _company_id: string
          _created_by: string
          _opportunity_id: string
          _owner_id: string
          _rfq_id: string
          _tender_id: string
          _user_id: string
        }
        Returns: boolean
      }
      can_read_ai_recommendation: {
        Args: { _entity_id: string; _entity_type: string; _user_id: string }
        Returns: boolean
      }
      can_read_attachments: { Args: { _user_id: string }; Returns: boolean }
      can_read_boq: {
        Args: { _opportunity_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_boq_revision: {
        Args: { _revision_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_commercial_cost: { Args: { _user_id: string }; Returns: boolean }
      can_read_contract: {
        Args: {
          _created_by: string
          _opportunity_id: string
          _responsible_user_id: string
          _user_id: string
        }
        Returns: boolean
      }
      can_read_document: {
        Args: { _document_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_historical_sales: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_read_opportunity_flag: {
        Args: {
          _action_owner_id: string
          _linked_record_id: string
          _linked_record_type: string
          _user_id: string
        }
        Returns: boolean
      }
      can_read_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_quotation: {
        Args: { _quotation_id: string; _user_id: string }
        Returns: boolean
      }
      can_read_sales_analytics: { Args: { _user_id: string }; Returns: boolean }
      can_review_intake: { Args: { _user_id: string }; Returns: boolean }
      can_use_discussion: { Args: { _user_id: string }; Returns: boolean }
      can_view_all_sales_data: { Args: { _user_id: string }; Returns: boolean }
      can_write_contract: { Args: { _user_id: string }; Returns: boolean }
      claim_ai_agent_request: {
        Args: {
          _agent_key: string
          _client_request_id: string
          _entity_id: string
          _entity_type: string
          _input_fingerprint?: string
          _requested_by: string
          _stale_after_seconds?: number
          _trace_id: string
        }
        Returns: {
          claim_id: string
          claimed: boolean
          request_output_id: string
          request_status: string
          request_trace_id: string
        }[]
      }
      current_margin_floor: { Args: never; Returns: number }
      current_sla_days: {
        Args: { _subject: Database["public"]["Enums"]["sla_subject"] }
        Returns: number
      }
      derive_attachment_path: { Args: { _value: string }; Returns: string }
      dismiss_notification: { Args: { _id: string }; Returns: boolean }
      document_entity_grants: {
        Args: {
          _entity_id: string
          _entity_type: Database["public"]["Enums"]["document_entity_type"]
          _user_id: string
        }
        Returns: boolean
      }
      emit_notification: {
        Args: {
          _body: string
          _dedupe_key: string
          _entity_id: string
          _entity_type: string
          _metadata?: Json
          _recipient: string
          _severity: string
          _source_event: string
          _title: string
          _type: string
        }
        Returns: string
      }
      emit_notification_to_roles: {
        Args: {
          _body: string
          _dedupe_key: string
          _entity_id: string
          _entity_type: string
          _metadata?: Json
          _roles: Database["public"]["Enums"]["app_role"][]
          _severity: string
          _source_event: string
          _title: string
          _type: string
        }
        Returns: number
      }
      estimation_cost_basis: {
        Args: { _estimation_id: string }
        Returns: number
      }
      execute_approved_record_delete: {
        Args: { _actor_id: string; _approval_id: string }
        Returns: Json
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      historical_raw_get: {
        Args: { _pattern: string; _raw: Json }
        Returns: string
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      is_commercial_manager: { Args: { _user_id: string }; Returns: boolean }
      is_pipeline_operator: { Args: { _user_id: string }; Returns: boolean }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_sales_contributor: { Args: { _user_id: string }; Returns: boolean }
      issue_project_number: { Args: { _project_id: string }; Returns: string }
      jsonb_has_money_key: { Args: { _payload: Json }; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notifications_read: { Args: { _ids: string[] }; Returns: number }
      match_knowledge: {
        Args: {
          filter_source_type?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      normalize_lead_key: {
        Args: { _location: string; _project_name: string }
        Returns: string
      }
      normalize_vendor_name: { Args: { _name: string }; Returns: string }
      notify_overdue_items: { Args: never; Returns: number }
      opportunity_value: {
        Args: {
          _contract_value: number
          _estimated_value_max: number
          _quotation_value: number
        }
        Returns: number
      }
      opportunity_win_weight: {
        Args: {
          _confidence: Database["public"]["Enums"]["win_confidence"]
          _human_probability: number
        }
        Returns: number
      }
      parse_historical_amount: { Args: { _v: string }; Returns: number }
      parse_historical_date: { Args: { _v: string }; Returns: string }
      parse_historical_route: { Args: { _v: string }; Returns: string }
      parse_historical_sales_code: {
        Args: { _v: string }
        Returns: {
          base_code: string
          is_placeholder: boolean
          parsed: boolean
          revision_no: number
          variant: string
        }[]
      }
      project_has_valid_boq: { Args: { _project_id: string }; Returns: boolean }
      project_number_denied_message: { Args: never; Returns: string }
      promote_historical_row: { Args: { _request_id: string }; Returns: string }
      register_legacy_documents: {
        Args: never
        Returns: {
          linked: number
          registered: number
          unlinked_orphans: number
        }[]
      }
      remap_historical_sales: {
        Args: { _batch_id: string }
        Returns: {
          amounts_unparsed: number
          codes_unparsed: number
          companies_unmatched: number
          owners_unmatched: number
          rows_mapped: number
        }[]
      }
      rerun_attachment_backfill: {
        Args: never
        Returns: {
          recovered: number
          reported: number
        }[]
      }
      run_sales_automations: {
        Args: { _trigger?: string }
        Returns: {
          raised: number
          run_id: string
        }[]
      }
      source_is_approved_for_agents: {
        Args: { _source: string }
        Returns: boolean
      }
      storage_object_readable: {
        Args: { _bucket: string; _path: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      account_status: "pending_review" | "active" | "dormant" | "do_not_target"
      action_type:
        | "request_boq"
        | "request_scope_clarification"
        | "follow_up_required"
        | "site_visit_required"
        | "price_approval_required"
        | "discount_approval_required"
        | "technical_review_required"
        | "vendor_quotation_required"
        | "contract_review_required"
        | "contact_verification_required"
        | "tender_decision_required"
        | "project_stage_verification_required"
        | "finance_or_risk_review_required"
      activity_status: "logged" | "draft" | "sent"
      activity_type:
        | "call"
        | "visit"
        | "meeting"
        | "email_draft"
        | "whatsapp_draft"
        | "note"
      agent_run_status:
        | "running"
        | "completed"
        | "needs_review"
        | "paused"
        | "error"
      app_role:
        | "ceo"
        | "sales_manager"
        | "bd_manager"
        | "viewer"
        | "salesperson"
        | "system_admin"
        | "managing_director"
        | "general_manager"
        | "sales_ops"
        | "finance_manager"
        | "estimation_manager"
      approval_recommendation: "proceed" | "management_review" | "do_not_quote"
      approval_status: "pending" | "approved" | "returned" | "escalated"
      artifact_status: "draft" | "awaiting_review" | "approved" | "rejected"
      artifact_type:
        | "stakeholder_map"
        | "pricing_brief"
        | "outreach_draft"
        | "qualification_brief"
        | "discovery_research_brief"
      boq_revision_status:
        | "draft"
        | "estimated_scope"
        | "partially_verified"
        | "verified"
        | "superseded"
      boq_source_type: "manual" | "ai_extraction" | "historical_import"
      boq_status:
        | "verified"
        | "partially_verified"
        | "estimated_scope"
        | "missing"
      commitment_direction: "we_owe_client" | "client_owes_us"
      commitment_status: "open" | "met" | "missed" | "waived" | "cancelled"
      company_type:
        | "main_contractor"
        | "developer"
        | "owner"
        | "consultant"
        | "existing_client"
        | "previous_client"
        | "target_account"
        | "vendor"
        | "do_not_target"
      confidence_level: "high" | "medium" | "low"
      contact_authority:
        | "decision_maker"
        | "influencer"
        | "technical_contact"
        | "unknown_authority"
      contact_confidence_level: "high" | "medium" | "low"
      contact_location: "site_office" | "head_office" | "unknown"
      document_entity_type:
        | "opportunity"
        | "rfq"
        | "tender"
        | "project"
        | "contract"
        | "boq"
        | "quotation"
        | "inbox_item"
        | "boq_revision"
        | "quotation_revision"
      document_type:
        | "boq"
        | "drawing"
        | "contract"
        | "quotation"
        | "photo"
        | "award_letter"
        | "submission"
        | "correspondence"
        | "report"
        | "other"
      exclusion_reason:
        | "no_signage_package"
        | "low_commercial_value"
        | "no_clear_contractor"
        | "outside_phc_scope"
        | "duplicate_opportunity"
        | "insufficient_evidence"
        | "other"
      flag_kind: "action_required" | "risk"
      flag_status:
        | "open"
        | "resolved"
        | "in_progress"
        | "completed"
        | "dismissed"
        | "escalated"
        | "blocked"
      flow_type: "direct_rfq" | "tender_converted" | "manual"
      follow_up_status:
        | "scheduled"
        | "due"
        | "overdue"
        | "completed"
        | "cancelled"
      handover_status: "pending" | "ready" | "handed_over"
      historical_promotion_status:
        | "draft"
        | "pending_review"
        | "approved"
        | "rejected"
        | "promoted"
        | "cancelled"
      inbox_classification:
        | "unclassified"
        | "company"
        | "contact"
        | "project"
        | "rfq"
        | "tender"
        | "opportunity_candidate"
        | "signal_watchlist"
        | "duplicate"
        | "incomplete"
      inbox_client_type:
        | "main_client"
        | "contractor_jih"
        | "contractor_tender"
        | "consultant"
      inbox_location:
        | "riyadh"
        | "jeddah"
        | "makkah"
        | "madinah"
        | "dammam"
        | "al_khobar"
        | "dhahran"
        | "jubail"
        | "taif"
        | "tabuk"
        | "abha"
        | "yanbu"
        | "jazan"
        | "buraydah"
        | "hail"
      inbox_project_type: "jih" | "tender"
      inbox_rfq_from: "owner_developer" | "main_contractor" | "consultant"
      inbox_scope:
        | "supply_and_installation"
        | "supply_only_signage"
        | "supply_installation_others"
        | "supply_only_others"
        | "mockup_sample_request"
        | "installation_only"
      inbox_source_type:
        | "manual_lead"
        | "manual_tender"
        | "manual_rfq"
        | "old_data_candidate"
        | "referral"
        | "market_signal"
        | "email_placeholder"
        | "whatsapp_placeholder"
      inbox_status:
        | "new"
        | "in_review"
        | "converted"
        | "sent_to_missing_data"
        | "marked_duplicate"
        | "archived"
      internal_price_status:
        | "draft"
        | "cost_complete"
        | "internal_price_proposed"
        | "commercial_review"
        | "finance_review"
        | "gm_pending"
        | "gm_approved"
        | "returned"
      lead_stage:
        | "detected"
        | "duplicate_check"
        | "research"
        | "contractor_identification"
        | "project_stage_check"
        | "signage_assessment"
        | "value_estimate"
        | "scored"
        | "human_review"
        | "converted"
        | "rejected"
      opportunity_milestone:
        | "rfq_received"
        | "quotation_sent"
        | "meeting_with_management"
        | "bafo_request"
        | "discount_sent"
        | "final_negotiation"
        | "received_contract"
      opportunity_score_tier: "A" | "B" | "C" | "not_qualified"
      opportunity_stage:
        | "discovery"
        | "qualification"
        | "preparation"
        | "quotation"
        | "follow_up"
        | "won"
        | "lost"
        | "archived"
      pipeline_step:
        | "new_project_detected"
        | "researching"
        | "needs_verification"
        | "qualified_lead"
        | "assigned"
        | "outreach_awaiting_approval"
        | "first_contact"
        | "discovery_site_validation"
        | "boq_requested"
        | "boq_received"
        | "boq_verified"
        | "proposal_preparation"
        | "proposal_submitted"
        | "negotiation"
        | "contract_review"
        | "won"
        | "lost"
        | "hold"
      priority_tier: "A" | "B" | "C"
      project_stage:
        | "early_planning"
        | "design_development"
        | "tender"
        | "awarded"
        | "under_construction"
        | "near_handover"
        | "completed"
        | "unknown"
      queue_action_type:
        | "follow_up_due"
        | "follow_up_overdue"
        | "missing_data"
        | "rfq_review_needed"
        | "tender_review_needed"
        | "approval_needed"
        | "quotation_follow_up"
        | "no_next_action"
        | "inactive_tier_a_opportunity"
        | "contract_evidence_missing"
        | "submission_pending_on"
      quotation_revision_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "submitted"
        | "superseded"
        | "withdrawn"
      quotation_status:
        | "draft"
        | "under_internal_review"
        | "approved_for_submission"
        | "submitted"
        | "follow_up"
        | "negotiation"
        | "revised"
        | "won"
        | "lost"
        | "expired"
      recommendation_status: "pending" | "accepted" | "dismissed" | "actioned"
      rfq_status: "open" | "converted" | "lost" | "on_hold"
      risk_flag:
        | "boq_missing"
        | "source_unverified"
        | "contact_not_confirmed"
        | "project_stage_unverified"
        | "package_may_be_closed"
        | "payment_risk"
        | "margin_risk"
        | "follow_up_overdue"
        | "contract_pending"
        | "approval_pending"
      sales_stage:
        | "rfq_received"
        | "jih"
        | "jih_bafo"
        | "under_negotiation"
        | "verbally_awarded"
        | "contract_received"
        | "contract_signed"
        | "won"
        | "lost"
        | "on_hold"
      signage_package_status:
        | "confirmed"
        | "likely"
        | "unknown"
        | "not_applicable"
        | "no_package_identified"
      sla_subject:
        | "stalled_deal"
        | "follow_up"
        | "commitment"
        | "price_review"
        | "lead_review"
        | "quotation_validity"
      supplier_quote_status:
        | "draft"
        | "sent"
        | "responses_received"
        | "evaluation"
        | "selected"
        | "frozen"
        | "cancelled"
        | "superseded"
      target_period: "monthly" | "quarterly" | "annual"
      tender_stage:
        | "tender_identified"
        | "tender_under_process"
        | "tender_bafo"
        | "award_negotiation"
        | "awarded_to_contractor"
        | "converted_to_jih"
        | "tender_lost_or_archived"
      user_status: "pending_approval" | "active" | "suspended" | "deleted"
      verification_status: "pending_verification" | "verified" | "rejected"
      win_confidence: "low" | "possible" | "strong" | "sure_win"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ["pending_review", "active", "dormant", "do_not_target"],
      action_type: [
        "request_boq",
        "request_scope_clarification",
        "follow_up_required",
        "site_visit_required",
        "price_approval_required",
        "discount_approval_required",
        "technical_review_required",
        "vendor_quotation_required",
        "contract_review_required",
        "contact_verification_required",
        "tender_decision_required",
        "project_stage_verification_required",
        "finance_or_risk_review_required",
      ],
      activity_status: ["logged", "draft", "sent"],
      activity_type: [
        "call",
        "visit",
        "meeting",
        "email_draft",
        "whatsapp_draft",
        "note",
      ],
      agent_run_status: [
        "running",
        "completed",
        "needs_review",
        "paused",
        "error",
      ],
      app_role: [
        "ceo",
        "sales_manager",
        "bd_manager",
        "viewer",
        "salesperson",
        "system_admin",
        "managing_director",
        "general_manager",
        "sales_ops",
        "finance_manager",
        "estimation_manager",
      ],
      approval_recommendation: ["proceed", "management_review", "do_not_quote"],
      approval_status: ["pending", "approved", "returned", "escalated"],
      artifact_status: ["draft", "awaiting_review", "approved", "rejected"],
      artifact_type: [
        "stakeholder_map",
        "pricing_brief",
        "outreach_draft",
        "qualification_brief",
        "discovery_research_brief",
      ],
      boq_revision_status: [
        "draft",
        "estimated_scope",
        "partially_verified",
        "verified",
        "superseded",
      ],
      boq_source_type: ["manual", "ai_extraction", "historical_import"],
      boq_status: [
        "verified",
        "partially_verified",
        "estimated_scope",
        "missing",
      ],
      commitment_direction: ["we_owe_client", "client_owes_us"],
      commitment_status: ["open", "met", "missed", "waived", "cancelled"],
      company_type: [
        "main_contractor",
        "developer",
        "owner",
        "consultant",
        "existing_client",
        "previous_client",
        "target_account",
        "vendor",
        "do_not_target",
      ],
      confidence_level: ["high", "medium", "low"],
      contact_authority: [
        "decision_maker",
        "influencer",
        "technical_contact",
        "unknown_authority",
      ],
      contact_confidence_level: ["high", "medium", "low"],
      contact_location: ["site_office", "head_office", "unknown"],
      document_entity_type: [
        "opportunity",
        "rfq",
        "tender",
        "project",
        "contract",
        "boq",
        "quotation",
        "inbox_item",
        "boq_revision",
        "quotation_revision",
      ],
      document_type: [
        "boq",
        "drawing",
        "contract",
        "quotation",
        "photo",
        "award_letter",
        "submission",
        "correspondence",
        "report",
        "other",
      ],
      exclusion_reason: [
        "no_signage_package",
        "low_commercial_value",
        "no_clear_contractor",
        "outside_phc_scope",
        "duplicate_opportunity",
        "insufficient_evidence",
        "other",
      ],
      flag_kind: ["action_required", "risk"],
      flag_status: [
        "open",
        "resolved",
        "in_progress",
        "completed",
        "dismissed",
        "escalated",
        "blocked",
      ],
      flow_type: ["direct_rfq", "tender_converted", "manual"],
      follow_up_status: [
        "scheduled",
        "due",
        "overdue",
        "completed",
        "cancelled",
      ],
      handover_status: ["pending", "ready", "handed_over"],
      historical_promotion_status: [
        "draft",
        "pending_review",
        "approved",
        "rejected",
        "promoted",
        "cancelled",
      ],
      inbox_classification: [
        "unclassified",
        "company",
        "contact",
        "project",
        "rfq",
        "tender",
        "opportunity_candidate",
        "signal_watchlist",
        "duplicate",
        "incomplete",
      ],
      inbox_client_type: [
        "main_client",
        "contractor_jih",
        "contractor_tender",
        "consultant",
      ],
      inbox_location: [
        "riyadh",
        "jeddah",
        "makkah",
        "madinah",
        "dammam",
        "al_khobar",
        "dhahran",
        "jubail",
        "taif",
        "tabuk",
        "abha",
        "yanbu",
        "jazan",
        "buraydah",
        "hail",
      ],
      inbox_project_type: ["jih", "tender"],
      inbox_rfq_from: ["owner_developer", "main_contractor", "consultant"],
      inbox_scope: [
        "supply_and_installation",
        "supply_only_signage",
        "supply_installation_others",
        "supply_only_others",
        "mockup_sample_request",
        "installation_only",
      ],
      inbox_source_type: [
        "manual_lead",
        "manual_tender",
        "manual_rfq",
        "old_data_candidate",
        "referral",
        "market_signal",
        "email_placeholder",
        "whatsapp_placeholder",
      ],
      inbox_status: [
        "new",
        "in_review",
        "converted",
        "sent_to_missing_data",
        "marked_duplicate",
        "archived",
      ],
      internal_price_status: [
        "draft",
        "cost_complete",
        "internal_price_proposed",
        "commercial_review",
        "finance_review",
        "gm_pending",
        "gm_approved",
        "returned",
      ],
      lead_stage: [
        "detected",
        "duplicate_check",
        "research",
        "contractor_identification",
        "project_stage_check",
        "signage_assessment",
        "value_estimate",
        "scored",
        "human_review",
        "converted",
        "rejected",
      ],
      opportunity_milestone: [
        "rfq_received",
        "quotation_sent",
        "meeting_with_management",
        "bafo_request",
        "discount_sent",
        "final_negotiation",
        "received_contract",
      ],
      opportunity_score_tier: ["A", "B", "C", "not_qualified"],
      opportunity_stage: [
        "discovery",
        "qualification",
        "preparation",
        "quotation",
        "follow_up",
        "won",
        "lost",
        "archived",
      ],
      pipeline_step: [
        "new_project_detected",
        "researching",
        "needs_verification",
        "qualified_lead",
        "assigned",
        "outreach_awaiting_approval",
        "first_contact",
        "discovery_site_validation",
        "boq_requested",
        "boq_received",
        "boq_verified",
        "proposal_preparation",
        "proposal_submitted",
        "negotiation",
        "contract_review",
        "won",
        "lost",
        "hold",
      ],
      priority_tier: ["A", "B", "C"],
      project_stage: [
        "early_planning",
        "design_development",
        "tender",
        "awarded",
        "under_construction",
        "near_handover",
        "completed",
        "unknown",
      ],
      queue_action_type: [
        "follow_up_due",
        "follow_up_overdue",
        "missing_data",
        "rfq_review_needed",
        "tender_review_needed",
        "approval_needed",
        "quotation_follow_up",
        "no_next_action",
        "inactive_tier_a_opportunity",
        "contract_evidence_missing",
        "submission_pending_on",
      ],
      quotation_revision_status: [
        "draft",
        "pending_approval",
        "approved",
        "submitted",
        "superseded",
        "withdrawn",
      ],
      quotation_status: [
        "draft",
        "under_internal_review",
        "approved_for_submission",
        "submitted",
        "follow_up",
        "negotiation",
        "revised",
        "won",
        "lost",
        "expired",
      ],
      recommendation_status: ["pending", "accepted", "dismissed", "actioned"],
      rfq_status: ["open", "converted", "lost", "on_hold"],
      risk_flag: [
        "boq_missing",
        "source_unverified",
        "contact_not_confirmed",
        "project_stage_unverified",
        "package_may_be_closed",
        "payment_risk",
        "margin_risk",
        "follow_up_overdue",
        "contract_pending",
        "approval_pending",
      ],
      sales_stage: [
        "rfq_received",
        "jih",
        "jih_bafo",
        "under_negotiation",
        "verbally_awarded",
        "contract_received",
        "contract_signed",
        "won",
        "lost",
        "on_hold",
      ],
      signage_package_status: [
        "confirmed",
        "likely",
        "unknown",
        "not_applicable",
        "no_package_identified",
      ],
      sla_subject: [
        "stalled_deal",
        "follow_up",
        "commitment",
        "price_review",
        "lead_review",
        "quotation_validity",
      ],
      supplier_quote_status: [
        "draft",
        "sent",
        "responses_received",
        "evaluation",
        "selected",
        "frozen",
        "cancelled",
        "superseded",
      ],
      target_period: ["monthly", "quarterly", "annual"],
      tender_stage: [
        "tender_identified",
        "tender_under_process",
        "tender_bafo",
        "award_negotiation",
        "awarded_to_contractor",
        "converted_to_jih",
        "tender_lost_or_archived",
      ],
      user_status: ["pending_approval", "active", "suspended", "deleted"],
      verification_status: ["pending_verification", "verified", "rejected"],
      win_confidence: ["low", "possible", "strong", "sure_win"],
    },
  },
} as const

// ─── Hand-written additions ──────────────────────────────────────────────────
// NOT generated. `supabase gen types` overwrites this file wholesale, so these
// must be re-appended after every regeneration — they were silently lost during
// the 2026-08-06 regen and only typecheck caught it.
export type ImportSplitProposal = {
  id: string;
  batch_id: string;
  source_row_id: string;
  entity_type: string;
  proposed_payload: Record<string, unknown>;
  role: string | null;
  ai_output_id: string | null;
  review_status: "pending" | "accepted" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type AiAgentOutput = {
  id: string;
  agent_key: string;
  entity_type: string;
  entity_id: string;
  output_type: string;
  status: string;
  result: Record<string, unknown>;
  created_at: string;
};

export type AiAgentCallResult =
  | { ok: true; outputId: string; traceId: string; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; traceId: string | null };
