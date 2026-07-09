DO $$
DECLARE
  rec RECORD;
  new_graph jsonb;
  node_idx int;
BEGIN
  FOR rec IN
    SELECT a.id, a.graph
    FROM public.automations a
    WHERE jsonb_typeof(a.graph->'nodes') = 'array'
      AND a.graph::text LIKE '%set_status%'
  LOOP
    new_graph := rec.graph;
    FOR node_idx IN
      SELECT (idx - 1)::int
      FROM jsonb_array_elements(rec.graph->'nodes') WITH ORDINALITY AS t(node, idx)
      WHERE t.node->>'type' = 'set_status'
        AND lower(COALESCE(t.node->'data'->>'status', 'resolvido')) IN (
          'resolvido','resolved','done','closed','solved','complete','completed',
          'finalizado','finalizada','concluido','concluído'
        )
        AND NOT (t.node->'data' ? 'resolve_pipeline_cards')
    LOOP
      new_graph := jsonb_set(
        new_graph,
        ARRAY['nodes', node_idx::text, 'data', 'resolve_pipeline_cards'],
        'true'::jsonb,
        true
      );
    END LOOP;
    IF new_graph IS DISTINCT FROM rec.graph THEN
      UPDATE public.automations SET graph = new_graph WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;