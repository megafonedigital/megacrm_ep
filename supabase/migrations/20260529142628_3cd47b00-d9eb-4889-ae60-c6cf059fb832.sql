UPDATE conversations
   SET status = 'resolvido', updated_at = now()
 WHERE id IN (
   SELECT ar.conversation_id
     FROM broadcast_targets bt
     JOIN automation_runs ar ON ar.id = bt.run_id
    WHERE bt.broadcast_id = '702335f4-232a-4749-a68e-8e3ee7ab21d8'
      AND ar.status = 'waiting_button'
 )
 AND status = 'aberto';