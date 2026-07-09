
DELETE FROM messages WHERE brand_id='8569eeff-0a3a-42af-91a3-2145dcbccbfe' AND conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ('3b7033f3-5665-4caa-b6d9-37e7f5ad7f95','1c34c53e-4575-4994-aae5-02ecf9a04475'));
DELETE FROM error_logs WHERE brand_id='8569eeff-0a3a-42af-91a3-2145dcbccbfe' AND conversation_id IN (SELECT id FROM conversations WHERE contact_id IN ('3b7033f3-5665-4caa-b6d9-37e7f5ad7f95','1c34c53e-4575-4994-aae5-02ecf9a04475'));
DELETE FROM conversations WHERE contact_id IN ('3b7033f3-5665-4caa-b6d9-37e7f5ad7f95','1c34c53e-4575-4994-aae5-02ecf9a04475');
DELETE FROM contacts WHERE id IN ('3b7033f3-5665-4caa-b6d9-37e7f5ad7f95','1c34c53e-4575-4994-aae5-02ecf9a04475');
DELETE FROM error_logs WHERE brand_id='8569eeff-0a3a-42af-91a3-2145dcbccbfe' AND category='webhook' AND created_at > now() - interval '1 hour' AND technical_message LIKE '%Cannot read properties of null%';
