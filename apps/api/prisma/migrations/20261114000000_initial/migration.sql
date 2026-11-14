-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('UPLOADING', 'QUEUED', 'PROCESSING', 'REVIEW_READY', 'FAILED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('SCHEDULED', 'DONE', 'SKIPPED', 'MISSED');

-- CreateEnum
CREATE TYPE "CareRole" AS ENUM ('PATIENT', 'CAREGIVER');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SUBMITTED', 'ACCEPTED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberVerified" BOOLEAN,
    "ai_processing_consent_version" TEXT,
    "ai_processing_consented_at" TIMESTAMP(3),
    "ai_processing_consent_withdrawn_at" TIMESTAMP(3),
    "chat_processing_consented_at" TIMESTAMP(3),
    "chat_processing_consent_version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "mark_open_before_minutes" INTEGER NOT NULL DEFAULT 90,
    "mark_close_after_minutes" INTEGER NOT NULL DEFAULT 180,
    "daily_routine" JSONB,
    "health_profile" JSONB,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_turns" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reply" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_memories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_memberships" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "CareRole" NOT NULL,
    "missed_alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "missed_alerts_enabled_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "care_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_invitations" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "phone_number" TEXT,
    "email" TEXT,
    "role" "CareRole" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT,
    "uploaded_by_id" TEXT,
    "file_name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extractions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "review" JSONB,
    "run_dir" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "suggested_name" TEXT NOT NULL,
    "confirmed_by_id" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_items" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "extraction_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "instruction_text" TEXT NOT NULL,
    "action_text" TEXT,
    "explanation" JSONB,
    "fields" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "evidence_span_ids" JSONB NOT NULL,
    "physio" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrences" (
    "id" TEXT NOT NULL,
    "plan_item_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expo_push_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "push_device_id" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expo_ticket_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "receipt_checked_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrence_logs" (
    "id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrence_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "near_wallets" (
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "public_key" TEXT,
    "connected_at" TIMESTAMP(3),
    "pending_account_id" TEXT,
    "challenge" TEXT,
    "challenge_nonce" TEXT,
    "challenge_expires" TIMESTAMP(3),

    CONSTRAINT "near_wallets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "near_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "previous_id" TEXT,
    "signer_account_id" TEXT,
    "signer_public_key" TEXT,
    "signature" TEXT,
    "signed_at" TIMESTAMP(3),
    "batch_id" TEXT,
    "leaf_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "near_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "near_batches" (
    "id" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "leaves" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FROZEN',
    "transaction" TEXT,
    "signed_tx" TEXT,
    "publisher" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "error" TEXT,
    "submitted_at" TIMESTAMP(3),
    "anchored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "near_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "near_policies" (
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "transaction" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "near_policies_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_phoneNumber_key" ON "user"("phoneNumber");

-- CreateIndex
CREATE INDEX "account_deletion_requests_email_created_at_idx" ON "account_deletion_requests"("email", "created_at");

-- CreateIndex
CREATE INDEX "account_deletion_requests_phone_number_created_at_idx" ON "account_deletion_requests"("phone_number", "created_at");

-- CreateIndex
CREATE INDEX "account_deletion_requests_created_at_idx" ON "account_deletion_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "chat_turns_user_id_patient_id_created_at_idx" ON "chat_turns"("user_id", "patient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_turns_user_id_patient_id_request_id_key" ON "chat_turns"("user_id", "patient_id", "request_id");

-- CreateIndex
CREATE INDEX "chat_memories_user_id_patient_id_created_at_idx" ON "chat_memories"("user_id", "patient_id", "created_at");

-- CreateIndex
CREATE INDEX "care_memberships_user_id_revoked_at_idx" ON "care_memberships"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "care_memberships_patient_id_user_id_key" ON "care_memberships"("patient_id", "user_id");

-- CreateIndex
CREATE INDEX "care_invitations_phone_number_accepted_at_revoked_at_idx" ON "care_invitations"("phone_number", "accepted_at", "revoked_at");

-- CreateIndex
CREATE INDEX "care_invitations_email_accepted_at_revoked_at_idx" ON "care_invitations"("email", "accepted_at", "revoked_at");

-- CreateIndex
CREATE INDEX "care_invitations_patient_id_idx" ON "care_invitations"("patient_id");

-- CreateIndex
CREATE INDEX "audit_events_patient_id_created_at_idx" ON "audit_events"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_patient_id_created_at_idx" ON "documents"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "extractions_status_created_at_idx" ON "extractions"("status", "created_at");

-- CreateIndex
CREATE INDEX "extractions_plan_id_idx" ON "extractions"("plan_id");

-- CreateIndex
CREATE INDEX "plans_patient_id_status_idx" ON "plans"("patient_id", "status");

-- CreateIndex
CREATE INDEX "plan_items_extraction_id_idx" ON "plan_items"("extraction_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_items_plan_id_extraction_id_candidate_id_key" ON "plan_items"("plan_id", "extraction_id", "candidate_id");

-- CreateIndex
CREATE INDEX "occurrences_scheduled_at_status_idx" ON "occurrences"("scheduled_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "occurrences_plan_item_id_scheduled_at_key" ON "occurrences"("plan_item_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_expo_push_token_key" ON "push_devices"("expo_push_token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_disabled_at_idx" ON "push_devices"("user_id", "disabled_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_once_per_device" ON "notification_deliveries"("occurrence_id", "membership_id", "push_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "near_events_digest_key" ON "near_events"("digest");

-- CreateIndex
CREATE INDEX "near_events_patient_id_created_at_idx" ON "near_events"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "near_events_batch_id_idx" ON "near_events"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "near_events_kind_subject_id_key" ON "near_events"("kind", "subject_id");

-- CreateIndex
CREATE INDEX "near_batches_status_created_at_idx" ON "near_batches"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "near_policies_hash_key" ON "near_policies"("hash");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_memories" ADD CONSTRAINT "chat_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_memories" ADD CONSTRAINT "chat_memories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_memberships" ADD CONSTRAINT "care_memberships_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_memberships" ADD CONSTRAINT "care_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_invitations" ADD CONSTRAINT "care_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "extractions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "plan_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "care_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_push_device_id_fkey" FOREIGN KEY ("push_device_id") REFERENCES "push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_logs" ADD CONSTRAINT "occurrence_logs_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_logs" ADD CONSTRAINT "occurrence_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "near_wallets" ADD CONSTRAINT "near_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "near_events" ADD CONSTRAINT "near_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "near_events" ADD CONSTRAINT "near_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "near_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

