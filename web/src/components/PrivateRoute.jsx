import { Navigate, useLocation } from 'react-router-dom';

function PrivateRoute({ children }) {
  const location = useLocation();
  if (!localStorage.getItem('user')) {
    return <Navigate to='/login' state={{ from: location }} />;
  }
  return children;
}

export { PrivateRoute };
