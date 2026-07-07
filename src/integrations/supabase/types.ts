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
    PostgrestVersion: "14.5"
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
          status: Database["public"]["Enums"]["activity_status"]
          summary: string | null
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
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
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
          status?: Database["public"]["Enums"]["activity_status"]
          summary?: string | null
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
            referencedRelation: "opportunities"
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
          id: string
          recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id: string
          requested_by: string | null
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
          id?: string
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id: string
          requested_by?: string | null
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
          id?: string
          recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          related_opportunity_id?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
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
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          after_value: Json | null
          before_value: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          timestamp: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          timestamp?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          after_value?: Json | null
          before_value?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          timestamp?: string
        }
        Relationships: []
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
            referencedRelation: "boqs"
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
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_owner_id: string | null
          account_status: Database["public"]["Enums"]["account_status"]
          company_type: Database["public"]["Enums"]["company_type"]
          created_at: string
          created_by: string | null
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
        }
        Insert: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          company_type?: Database["public"]["Enums"]["company_type"]
          created_at?: string
          created_by?: string | null
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
        }
        Update: {
          account_owner_id?: string | null
          account_status?: Database["public"]["Enums"]["account_status"]
          company_type?: Database["public"]["Enums"]["company_type"]
          created_at?: string
          created_by?: string | null
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
        }
        Relationships: []
      }
      contacts: {
        Row: {
          authority: Database["public"]["Enums"]["contact_authority"]
          company_id: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          email: string | null
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
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
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
          authority?: Database["public"]["Enums"]["contact_authority"]
          company_id?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
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
      evidence_sources: {
        Row: {
          confidence_level: Database["public"]["Enums"]["confidence_level"]
          created_at: string
          extracted_summary: string | null
          id: string
          related_opportunity_id: string
          source_date: string | null
          source_title: string
          source_type: string
          source_url: string | null
          vault_path: string | null
        }
        Insert: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          id?: string
          related_opportunity_id: string
          source_date?: string | null
          source_title: string
          source_type: string
          source_url?: string | null
          vault_path?: string | null
        }
        Update: {
          confidence_level?: Database["public"]["Enums"]["confidence_level"]
          created_at?: string
          extracted_summary?: string | null
          id?: string
          related_opportunity_id?: string
          source_date?: string | null
          source_title?: string
          source_type?: string
          source_url?: string | null
          vault_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_sources_related_opportunity_id_fkey"
            columns: ["related_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
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
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          converted_opportunity_id: string | null
          created_at: string
          created_by: string | null
          duplicate_of: string | null
          estimated_value: number | null
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
          signage_potential:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of?: string | null
          estimated_value?: number | null
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
          signage_potential?:
            | Database["public"]["Enums"]["confidence_level"]
            | null
          source?: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          converted_opportunity_id?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_of?: string | null
          estimated_value?: number | null
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
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          agent_reasoning: string | null
          agent_recommendation:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client: string | null
          company_id: string | null
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
          id: string
          last_activity_at: string | null
          location: string | null
          main_contractor: string | null
          main_contractor_confirmed: boolean
          main_contractor_id: string | null
          management_review_reason: string | null
          next_action: string | null
          next_action_due: string | null
          owner_id: string | null
          package_budget_confirmed: boolean
          pipeline_step: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status: string | null
          project_id: string | null
          project_name: string
          project_stage: Database["public"]["Enums"]["project_stage"]
          quotation_value: number | null
          sector: string | null
          signage_package_confidence: Database["public"]["Enums"]["confidence_level"]
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          stage: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value: string | null
          tier: Database["public"]["Enums"]["priority_tier"]
          updated_at: string
        }
        Insert: {
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          company_id?: string | null
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
          id?: string
          last_activity_at?: string | null
          location?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
        }
        Update: {
          agent_reasoning?: string | null
          agent_recommendation?:
            | Database["public"]["Enums"]["approval_recommendation"]
            | null
          client?: string | null
          company_id?: string | null
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
          id?: string
          last_activity_at?: string | null
          location?: string | null
          main_contractor?: string | null
          main_contractor_confirmed?: boolean
          main_contractor_id?: string | null
          management_review_reason?: string | null
          next_action?: string | null
          next_action_due?: string | null
          owner_id?: string | null
          package_budget_confirmed?: boolean
          pipeline_step?: Database["public"]["Enums"]["pipeline_step"] | null
          prequalification_status?: string | null
          project_id?: string | null
          project_name?: string
          project_stage?: Database["public"]["Enums"]["project_stage"]
          quotation_value?: number | null
          sector?: string | null
          signage_package_confidence?: Database["public"]["Enums"]["confidence_level"]
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          strategic_value?: string | null
          tier?: Database["public"]["Enums"]["priority_tier"]
          updated_at?: string
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
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          language?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          completion_pct: number | null
          consultant_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          expected_boq_date: string | null
          expected_signage_date: string | null
          id: string
          location: string | null
          main_contractor_id: string | null
          name: string
          notes: string | null
          owner_company_id: string | null
          project_stage: Database["public"]["Enums"]["project_stage"]
          sector: string | null
          signage_package_status: Database["public"]["Enums"]["signage_package_status"]
          source: string | null
          source_confidence: Database["public"]["Enums"]["confidence_level"]
          total_value: number | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          completion_pct?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name: string
          notes?: string | null
          owner_company_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
          source?: string | null
          source_confidence?: Database["public"]["Enums"]["confidence_level"]
          total_value?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          completion_pct?: number | null
          consultant_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_boq_date?: string | null
          expected_signage_date?: string | null
          id?: string
          location?: string | null
          main_contractor_id?: string | null
          name?: string
          notes?: string | null
          owner_company_id?: string | null
          project_stage?: Database["public"]["Enums"]["project_stage"]
          sector?: string | null
          signage_package_status?: Database["public"]["Enums"]["signage_package_status"]
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
      quotations: {
        Row: {
          boq_id: string | null
          created_at: string
          created_by: string | null
          currency: string
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
            referencedRelation: "boqs"
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
            referencedRelation: "leads"
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
      sales_targets: {
        Row: {
          activity_target: number
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
            referencedRelation: "opportunities"
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
            referencedRelation: "opportunities"
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
          internal_notes: string | null
          internal_rating: number | null
          lead_time: string | null
          materials: string | null
          name: string
          portal_url: string | null
          previous_projects: string | null
          qualification_files: string | null
          quality_level: string | null
          reference_prices: string | null
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
          internal_notes?: string | null
          internal_rating?: number | null
          lead_time?: string | null
          materials?: string | null
          name: string
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          reference_prices?: string | null
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
          internal_notes?: string | null
          internal_rating?: number | null
          lead_time?: string | null
          materials?: string | null
          name?: string
          portal_url?: string | null
          previous_projects?: string | null
          qualification_files?: string | null
          quality_level?: string | null
          reference_prices?: string | null
          scope?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      vendors_public: {
        Row: {
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string | null
          lead_time: string | null
          materials: string | null
          name: string | null
          portal_url: string | null
          previous_projects: string | null
          quality_level: string | null
          scope: string | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          lead_time?: string | null
          materials?: string | null
          name?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string | null
          lead_time?: string | null
          materials?: string | null
          name?: string | null
          portal_url?: string | null
          previous_projects?: string | null
          quality_level?: string | null
          scope?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
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
    }
    Enums: {
      account_status: "pending_review" | "active" | "dormant" | "do_not_target"
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
      approval_recommendation: "proceed" | "management_review" | "do_not_quote"
      approval_status: "pending" | "approved" | "returned" | "escalated"
      artifact_status: "draft" | "awaiting_review" | "approved" | "rejected"
      artifact_type:
        | "stakeholder_map"
        | "pricing_brief"
        | "outreach_draft"
        | "qualification_brief"
        | "discovery_research_brief"
      boq_status:
        | "verified"
        | "partially_verified"
        | "estimated_scope"
        | "missing"
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
      contact_location: "site_office" | "head_office" | "unknown"
      exclusion_reason:
        | "no_signage_package"
        | "low_commercial_value"
        | "no_clear_contractor"
        | "outside_phc_scope"
        | "duplicate_opportunity"
        | "insufficient_evidence"
        | "other"
      follow_up_status:
        | "scheduled"
        | "due"
        | "overdue"
        | "completed"
        | "cancelled"
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
      signage_package_status:
        | "confirmed"
        | "likely"
        | "unknown"
        | "not_applicable"
        | "no_package_identified"
      target_period: "monthly" | "quarterly"
      verification_status: "pending_verification" | "verified" | "rejected"
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
      app_role: ["ceo", "sales_manager", "bd_manager", "viewer", "salesperson"],
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
      boq_status: [
        "verified",
        "partially_verified",
        "estimated_scope",
        "missing",
      ],
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
      contact_location: ["site_office", "head_office", "unknown"],
      exclusion_reason: [
        "no_signage_package",
        "low_commercial_value",
        "no_clear_contractor",
        "outside_phc_scope",
        "duplicate_opportunity",
        "insufficient_evidence",
        "other",
      ],
      follow_up_status: [
        "scheduled",
        "due",
        "overdue",
        "completed",
        "cancelled",
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
      signage_package_status: [
        "confirmed",
        "likely",
        "unknown",
        "not_applicable",
        "no_package_identified",
      ],
      target_period: ["monthly", "quarterly"],
      verification_status: ["pending_verification", "verified", "rejected"],
    },
  },
} as const
