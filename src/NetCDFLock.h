/**
 * @file NetCDFLock.h
 * @brief Serialises every entry into the NetCDF and HDF5 libraries
 * @copyright Copyright (C) 2025 ForeFire, Fire Team, SPE, CNRS/Universita di Corsica.
 * @license This program is free software; See LICENSE file for details. (See LICENSE file).
 */

#ifndef NETCDFLOCK_H_
#define NETCDFLOCK_H_

#include <mutex>

namespace libforefire {

/*! \brief the lock held for the duration of any NetCDF operation
 *
 * Neither of the libraries underneath ForeFire is safe to call from several
 * threads at once:
 *
 *  - libnetcdf keeps its open-file table and error state in globals and takes
 *    no locks of its own. Building it differently does not help; upstream has
 *    never claimed the C library is thread-safe.
 *  - libhdf5 is only thread-safe when built with --enable-threadsafe, which
 *    the distribution packages are not, and even then it serialises on one
 *    global lock, so it buys concurrency nowhere.
 *
 * Holding this lock across whole operations gives the same concurrency a
 * thread-safe HDF5 would, covers libnetcdf's own globals which HDF5's lock
 * would not, and keeps ForeFire on the ordinary distribution packages.
 *
 * Recursive because the read path nests: loadFromNCFile takes the lock and
 * then calls the constructXYZTLayer family, which is also reachable on its
 * own.
 */
inline std::recursive_mutex& netCDFMutex(){
	static std::recursive_mutex m;
	return m;
}

/*! \brief scoped guard for the NetCDF lock */
#define FOREFIRE_NETCDF_LOCK() \
	std::lock_guard<std::recursive_mutex> netCDFGuard(libforefire::netCDFMutex())

}

#endif /* NETCDFLOCK_H_ */
