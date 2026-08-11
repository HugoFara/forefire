/**
 * @file EventCommand.h
 * @brief  Definitions for the class that defines hos to send a specific command to the interpreter at a scheduled time (an time Atom that can be schedueled)
 * @copyright Copyright (C) 2025 ForeFire, Fire Team, SPE, CNRS/Universita di Corsica.
 * @license This program is free software; See LICENSE file for details. (See LICENSE file).
 * @author Jean‑Baptiste Filippi — 2025
 */

#ifndef EVENTCOMMAND_H_
#define EVENTCOMMAND_H_

#include "include/Futils.h"
#include "ForeFireAtom.h"

using namespace std;

namespace libforefire{

// Forward declared rather than included: Command.h includes this header, so
// including it back would be circular. Only a pointer is needed here.
class Command;

/*! \class EventCommand
 * \brief TODO
 *
 *  Detail
 */
class EventCommand: public ForeFireAtom {

	string schedueledCommand;
	/*! \brief interpreter this event runs its command on.
	 *
	 * The command used to go to a process-wide Command, which meant an event
	 * scheduled by one simulation would run against whichever simulation
	 * happened to exist later. It now belongs to the Command that scheduled it.
	 */
	Command* executor;

public:
	/*! \brief Default constructor */
	EventCommand() : ForeFireAtom(0.), executor(0) {};
	/*! \brief standard constructor */
	EventCommand( string, double, Command* ) ;
	/*! \brief Default destructor */
	~EventCommand();

	/* making the 'update()', 'timeAdvance()' and 'accept()'
	 * virtual functions of 'ForeFireAtom' not virtual */

	void input();
	void update();
	void timeAdvance();
	void output();

	string  toString();
};

}

#endif /* EVENTCOMMAND_H_ */
