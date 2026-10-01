import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import { OwlMark } from '@/components/common/Logo';

function Message({ code, title, detail }: { code: string; title: string; detail: string }) {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', p: 2 }}>
      <Stack spacing={2} alignItems="center" textAlign="center">
        <OwlMark size={56} />
        <Typography
          variant="h1"
          component="p"
          sx={{ fontSize: '3rem', color: 'text.disabled' }}
        >
          {code}
        </Typography>
        <Typography variant="h2" component="h1">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {detail}
        </Typography>
        <Button component={RouterLink} to="/" variant="contained">
          Back to dashboard
        </Button>
      </Stack>
    </Box>
  );
}

export function ForbiddenPage() {
  return (
    <Message
      code="403"
      title="You do not have access to this page"
      detail="Your role does not include the permissions this page requires. Contact HR or an administrator if you believe this is a mistake."
    />
  );
}

export function NotFoundPage() {
  return (
    <Message
      code="404"
      title="Page not found"
      detail="The page you are looking for does not exist or has moved."
    />
  );
}
