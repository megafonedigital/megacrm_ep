WITH node_media AS (
  SELECT
    n->'data'->>'templateName' AS tpl_name,
    n->'data'->>'templateHeaderMediaUrl' AS media_url,
    n->'data'->>'templateHeaderMediaFilename' AS media_filename
  FROM automations, jsonb_array_elements(graph->'nodes') n
  WHERE id = '0ee8ac41-f8e9-494c-ad9c-59880c733c28'
    AND n->'data' ? 'templateHeaderMediaUrl'
    AND (n->'data'->>'templateHeaderMediaUrl') IS NOT NULL
)
UPDATE messages m
SET media_url = nm.media_url,
    media_filename = COALESCE(m.media_filename, nm.media_filename)
FROM node_media nm
WHERE m.type = 'template'
  AND m.media_url IS NULL
  AND m.template_name = nm.tpl_name;