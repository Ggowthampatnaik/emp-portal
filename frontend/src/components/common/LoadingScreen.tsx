import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

import { OwlMark } from '@/components/common/Logo';

interface Props {
  message?: string;
}

export default function LoadingScreen({ message = 'Loading...' }: Props) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: '60vh',
      }}
      role="status"
      aria-live="polite"
    >
      {/* The mark sits inside the spinner ring, so waiting still feels branded. */}
      <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={72} thickness={2} />
        <Box sx={{ position: 'absolute' }}>
          <OwlMark size={34} />
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
