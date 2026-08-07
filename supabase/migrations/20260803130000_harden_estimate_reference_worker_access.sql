-- Restrict estimate-reference helper RPCs to trusted background workers.

CREATE OR REPLACE FUNCTION public.increment_estimate_reference_usage(reference_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.estimate_references
  SET usage_count = usage_count + 1
  WHERE id = reference_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_estimate_reference_usage(UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_estimate_reference_usage(UUID)
TO service_role;

REVOKE ALL ON FUNCTION public.match_estimate_references(vector(1024), DOUBLE PRECISION, INTEGER)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_estimate_references(vector(1024), DOUBLE PRECISION, INTEGER)
TO service_role;
